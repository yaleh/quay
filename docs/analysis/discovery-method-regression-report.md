# Discovery Method — independent regression report

Task: `gap-discovery-method-loop-independent-regression`. This is the **independent regression run** of the
Discovery Method loop (`docs/analysis/discovery-{experience-ledger,method-registry,reflection}.mjs`) after
the four fix tasks landed:

| fix task | what it closed |
|---|---|
| `gap-discovery-method-generalization-lineage-and-temporal-binding` | held-out case must be outside the whole method LINEAGE; expected label must be true at a named `evaluation_pin` (stripped tree, never the live checkout) |
| `gap-discovery-method-record-tool-vs-subject-leak` | `operation.tools` may not be a seed subject file (`TOOL_IS_SUBJECT`); method free text may not name a seed (`METHOD_TEXT_NAMES_SEED`) |
| `gap-discovery-carriers-ephemeral-in-worktree` | every Discovery carrier resolves to the SHARED checkout; `draft→active` must cite a recorded verdict |
| `gap-discovery-experience-auto-ingest-from-evidence-store` | watermarked batch ingester; every Experience field DERIVED from the record (no hand narration) |

**It writes no new engine.** The only tracked deliverable is this report; every number below is a reading
from the real run, taken on 2026-10-12 in the task worktree
`/data/home/yale/work/quay-worktrees/gap-discovery-method-loop-independent-regression`
(branch `task/gap-discovery-method-loop-independent-regression`, fork point `676e15c6c` = `develop`),
driving the launcher `claude-fjdac` → LiteLLM gateway `http://127.0.0.1:26510/`, model
`v4.1flash-anthropic` (stream-reported `actual_model`, never a guess).

All Discovery carriers are resolved to the SHARED checkout, so nothing below was written under the
worktree's own `.quay/`:

```
$ ls -la /data/home/yale/work/quay/.quay/discovery-* /data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl
-rw-rw-r-- 1 yale yale 199797 Oct 12 02:59 …/architecture-evidence-store.jsonl      (270 lines)
-rw-rw-r-- 1 yale yale  94369 Oct 12 15:56 …/discovery-experience-ledger.jsonl       (118 records)
-rw-rw-r-- 1 yale yale   2730 Oct 12 16:33 …/discovery-generalization-verdicts.jsonl
-rw-rw-r-- 1 yale yale     94 Oct 12 16:08 …/discovery-ingest-watermark.json
-rw-rw-r-- 1 yale yale  58946 Oct 12 16:34 …/discovery-method-registry.jsonl
$ ls <worktree>/.quay/discovery-*                                                      → no such file
```

---

## AC1 — Automatic ingestion, real

Run from inside the task worktree; `ingestNewOutcomes` resolves the store, the watermark and the ledger
through `resolveCarrierRoot` (git-common-dir), so all three land in the shared checkout.

```
caller root (inside the task worktree): /data/home/yale/work/quay-worktrees/gap-discovery-method-loop-independent-regression
ledger before: 118 records, md5 c604e7f366fc2fbf5b70f28e540c4a27
watermark on disk: {"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}

=== RUN 1 (the incremental run production would make) ===
{"ok":true,"enabled":true,
 "store":"/data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl",
 "watermark_file":"/data/home/yale/work/quay/.quay/discovery-ingest-watermark.json",
 "scanned":0,"ingested":0,"duplicates":0,"skipped_not_ingestible":0,"malformed_lines":0,
 "remainder":0,"advanced_to":270,
 "watermark":{"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"},
 "reasons":null}
ledger after run 1: 118 records

=== RUN 2 (idempotence) ===
{"ok":true,"scanned":0,"ingested":0,"duplicates":0,"skipped_not_ingestible":0,"remainder":0,
 "advanced_to":270,"watermark":{"line":270,"line_sha256":"7549bc6e…"}}

=== CONTROL — the same call with the watermark moved aside (the 0 above must not be a dead mechanism) ===
{"ok":true,"scanned":121,"ingested":0,"duplicates":116,"skipped_not_ingestible":5,
 "malformed_lines":0,"remainder":0,"advanced_to":270,
 "watermark":{"line":270,"line_sha256":"7549bc6ef14496997861f9c82ec47cfa8d0b60577e005f5b0736b99388ad4b39"}}
watermark rewritten == the backup: true
ledger md5 after the control: c604e7f366fc2fbf5b70f28e540c4a27   → byte-identical to before
=== KILL SWITCH ===
{"ok":true,"enabled":false,"store":null,"watermark_file":null,"scanned":0,"ingested":0,"duplicates":0}
ledger unchanged: true
```

**Reading.** The summary the AC asks for is `scanned 0 / ingested 0 / duplicates 0`, watermark
`{"line":270,"line_sha256":"7549bc6e…"}` — because the store was already fully ingested to its last line by
the dependency task's run, and the ingester is watermarked. The 0 is a real 0, not a dead predicate: the
**control** (watermark removed, everything else identical) scans all **121** outcome records, re-derives
**116 duplicates** and passes **5** non-ingestible ownership-loop verdicts, rewrites the watermark to the
identical value and leaves the ledger **byte-identical** (md5 `c604e7f3…` both sides). `enabled:false`
answers before any I/O (store/watermark fields are `null`, not empty strings). The persisted path is
`/data/home/yale/work/quay/.quay/discovery-experience-ledger.jsonl` (118 records, 94 369 bytes).

---

## AC2 — Reflection, real

Budget stated per the Plan: `{enabled:true, maxPerRun:32/24, maxModelCalls:32/24, maxWallMs:1_800_000}`.
The batch is chosen **mechanically**, and in two bounded batches, because batch 1 produced no candidate whose
subject overlaps a *positive* holdout case (see “Deviation” below):

* **batch 1** — the 4 named seeds (`E-DT-1-Hp cluster 11` = fan-in lock, `E-HYPGEN-AB-1-B cluster 8` =
  REQUIRED_FIELDS, `E-HYPGEN-ACCEPT-1 cluster 5` = C5, `E-HYPGEN-ACCEPT-1 cluster 7` = C7) ∪ the 2
  user-sourced Experiences ∪ every ledger unit whose components overlap ≥1 file of
  `HX-reflog-empty-action-producer-vs-classifier`, `HX-promotion-classify-blind-to-unsatisfiable-ac`,
  `HX-neg-cpu-stall-readers-different-source` → **24 units, 24 calls, 0 skipped**.
* **batch 2** — every ledger unit whose components overlap ≥1 file of `HX-scope-memorymax-literal-vs-host-derived`,
  `HX-scope-argv-builders-oompolicy-divergence`, `HX-needs-human-transition-three-copies` → **16 units, 16 calls, 0 skipped**.

### 1. Every unit's decision

```
=== BATCH 1 (24 units) ===
EXP-carriers-ephemeral-in-worktree   extends   → carrier-persistence-check v2
EXP-post-gate-write                  extends   → carrier-persistence-check v3
EXP-d96d84c8f2a2cc1f                 no-method
EXP-60bdf3e1dd91a50b                 no-method
EXP-d63e8da954d5cb3b                 no-method
EXP-696a9770477e60e0                 new       REFUSED  METHOD_TEXT_NAMES_SEED:checker-io.ts, checker-mechanical-spine-check.ts, driver-result.ts, outer-anchor-check.ts
EXP-ee63601cc7031e95                 no-method                       ← C7 (the negative)
EXP-36c697a25760691b                 no-method
EXP-7fc0abd52428fd95                 new       REFUSED  METHOD_TEXT_NAMES_SEED:plugin/scripts/cap-from-gate.ts
EXP-6caecee9f5c81c93                 no-method
EXP-bb12a6858838e74b                 no-method                       ← REQUIRED_FIELDS
EXP-78532458f7a27748                 new       → non-substantive-verdict-triage v1
EXP-1847903d8615283e                 no-method
EXP-e1b2f0ee7ac5acaf                 no-method
EXP-4a18aac92df96201                 no-method
EXP-853b824ca48ff478                 no-method
EXP-6f54d9a8538d12e5                 no-method
EXP-831513918fa0038f                 no-method
EXP-3a975a7a2f2066a9                 no-method
EXP-50c3e142bd8af7e1                 no-method
EXP-219634eb5984967b                 no-method
EXP-31fc82ad5d6c1f86                 no-method                       ← the fan-in lock seed
EXP-3080f3f168247f30                 no-method
EXP-d4181493d1f5a810                 no-method

=== BATCH 2 (16 units) ===
EXP-895fde786fc27f2c                 extends   → non-substantive-verdict-triage v2
EXP-17881bed66c27d0f                 extends   REFUSED  METHOD_TEXT_NAMES_SEED:EXP-150111701d99f985, EXP-17881bed66c27d0f
EXP-3a06328f7a9ef713                 extends   → non-substantive-verdict-triage v3
EXP-a479b76da38cd895                 new       → composite-subject-verdict-decomposition v1
EXP-f2b16eb68c7c63ec                 no-method
EXP-5379cfe3b43937ae                 extends   → non-substantive-verdict-triage v4
EXP-b14845e18e17cc97                 extends   REFUSED  METHOD_TEXT_NAMES_SEED:claim-task.ts, concurrent-batch-scheduler.ts, driver-filters.ts, fast-mode-telemetry.ts, slot-refill.ts
EXP-900bf6e9dd54d389                 extends   → non-substantive-verdict-triage v5
EXP-0cb58f4f0cc6a232                 no-method
EXP-ef4d92f96f337cc5                 no-method
EXP-853b824ca48ff478                 extends   → non-substantive-verdict-triage v6
EXP-943fff7d5fbd52a3                 extends   → non-substantive-verdict-triage v7
EXP-f877be0f4b7a3045                 no-method
EXP-a7c84fa7c2bc1cb4                 extends   → non-substantive-verdict-triage v8
EXP-3f5afc05105406cb                 extends   REFUSED  METHOD_TEXT_NAMES_SEED:fan-in-ac-completion-gate.ts, gate-event-coverage-check.ts, loop-complete-task.ts, worker-driver.ts, worker-fan-in.ts
EXP-947eefa381396e21                 no-method
```

Tally: **24 `no-method`, 11 candidates persisted, 5 refusals, 0 budget-skips** (40 units total).

### 2. The candidates (`method_id` / version / status / `operation.tools`)

```
method_id                                ver  status  operation.tools                                                            stripped_subject_tools
carrier-persistence-check                v2   draft   [repo-root-derivation-check.ts, repo-root.ts, runtime-usage-inventory.ts]    []
carrier-persistence-check                v3   draft   [repo-root-derivation-check.ts, git-runner.ts, worktree-namespace-literal-check.ts]  []
non-substantive-verdict-triage           v1   draft   [readRecords, instrument-failure-check.ts]                                  []
non-substantive-verdict-triage           v2   draft   [readRecords, instrument-failure-check.ts, verification-marginal-return.ts] []
non-substantive-verdict-triage           v3   draft   [readRecords, validateRecord, instrument-failure-check.ts]                  []
non-substantive-verdict-triage           v4   draft   [readRecords, instrument-failure-check.ts, subjectKey]                      []
non-substantive-verdict-triage           v5   draft   [instrument-failure-check.ts, ci-red-attribute.ts, red-window-triage.ts]    []
non-substantive-verdict-triage           v6   draft   [instrument-failure-check.ts, self-report-vocab-audit.ts, discovery-path-classify.ts] []
non-substantive-verdict-triage           v7   draft   [readRecords, instrument-failure-check.ts, pre-verified-round-record.ts]     []
non-substantive-verdict-triage           v8   draft   [readRecords, validateRecord, discovery-path-classify.ts]                   []
composite-subject-verdict-decomposition  v1   draft   [readRecords, subjectFilesOf, read-probe-spec.ts]                           []
```

### 3. No tool is a seed subject file — checked by position, not by eye

For each candidate the seed subject basenames are re-derived from its OWN `provenance_evidence`
(`seedSetForRecord` over the ledger) and intersected with `operation.tools`:

```
candidates persisted: 11 | all clean: true            (subject_tools_present == [] for all 11)
stripped_subject_tools == [] for all 11               (nothing had to be stripped this round)
```

The **refusals** are the other half of the same rule — the registry refused five candidates whose free text
named a seed component or a seed case id (`METHOD_TEXT_NAMES_SEED`): e.g. the C5 unit's candidate named all
four of its own subject files (`checker-io.ts`, `checker-mechanical-spine-check.ts`, `driver-result.ts`,
`outer-anchor-check.ts`), and one named `plugin/scripts/cap-from-gate.ts`. Nothing was appended for them.

### 4. C7 (the negative) did NOT yield a standalone method

`EXP-ee63601cc7031e95` (`confirmed-negative`, the `E-HYPGEN-ACCEPT-1 cluster 7` refuted claim) →
`decision:"no-method"`, `ok:true`, `candidate:null`. The model declined to mint a standalone method from a
refuted claim, exactly as the prompt's rule 2 requires. No other candidate names it as a `counterexample`
either.

---

## AC3 — Independent generalization, real

Held-out material: the 6 sealed `holdout-*` cases of `E-DT-1` in the SEALED label file
`/data/home/yale/work/quay-scratch/dt1/labels-dt1-sealed.json` (sha of the file as committed by the
independent labeler), pin `f2432d17849e7bd375dbfa573ae55ea4efad171d`. **No holdout was relabelled.**
Labels → held-out Experience roles: `holdout-H` / `holdout-F` → `found-and-fixed` (expected
`["supported"]`), `holdout-negative` → `confirmed-negative` (expected `["refuted"]`); `diagnostic-public:*`
cases were **excluded** (the label file itself says they are “previously discussed; NEVER counted as blind”).

The verifier ran in a **stripped detached tree at the pin**:

```
materializeStrippedPin → {"ok":true,"dir":"…/dm-regression/pin-f2432d17","rev":"f2432d17…","stripped":true,
  "removed":["tasks","goals","docs","orchestration",".quay","archive","milestones","measurements","experiments","meta","adr"]}
verifyStrippedPin(pinDir) → null            (usable: not the live checkout, all 11 forbidden dirs gone)
plugin/scripts files in the pin: 384 ; all 10 holdout subject files present
probe: `classifyReflogAction` present at the pin: true ; “has no message to annotate” present at the pin: true
```

and the pin genuinely predates every fix (each `fix_commit` is **not** an ancestor of the pin):

```
be229861e  ancestor-of-pin? no        ccd8cc039  ancestor-of-pin? no        0834014db  ancestor-of-pin? no
c5ad1d146  ancestor-of-pin? no        9b01ac3d2  ancestor-of-pin? no
```

### Verdict 1 (positive held-out) — `non-substantive-verdict-triage@8` × `HX-needs-human-transition-three-copies`

```
candidate lineage (all recorded versions of its method_id): non-substantive-verdict-triage@1,2,3,4,5,6,7,8 (#9 appended after the test)
candidate provenance: ["experience-7f65eb76070d8765"]
seed subject components: plugin/scripts/{full-suite-runner,mirror-full-suite-state,red-window-triage,runner-state-write,slot-refill,suite-state-trigger}.ts
held-out id:            HX-needs-human-transition-three-copies     label role: holdout-F
held-out components:    plugin/scripts/worker-driver.ts, plugin/scripts/driver-filters.ts
shared with seed:       []          lineage isolation: {"ok":true,"hits":[]}
evaluated commit:       f2432d17849e7bd375dbfa573ae55ea4efad171d
verifier cwd:           /data/home/yale/work/quay-scratch/dm-regression/pin-f2432d178
lineage_ok: true   temporal_ok: true
predicted verdict: "refuted"   expected: ["supported"]   correct: false   promoted: NO
candidate status after: retired
retirement_reason: failed-generalization-on-HX-needs-human-transition-three-copies: predicted-refuted-but-role-found-and-fixed-requires-supported
verdict_ref: generalization_verdict-da8d59c3e7af4740     model call: 9 turns, $0.558812 (CLI)
```

### Verdict 2 (second positive held-out) — `composite-subject-verdict-decomposition@1` × `HX-scope-memorymax-literal-vs-host-derived`

```
candidate lineage: composite-subject-verdict-decomposition@1 (#2 appended after the test)
candidate provenance: ["experience-3af7e6e006435de2"]
seed subject components: plugin/scripts/{full-suite-runner-types,full-suite-runner,mirror-full-suite-state,suite-state-trigger}.ts
held-out id:            HX-scope-memorymax-literal-vs-host-derived      label role: holdout-H
held-out components:    plugin/scripts/driver-runtime.ts, plugin/scripts/full-suite-runner.ts
shared with seed:       ["plugin/scripts/full-suite-runner.ts"]   (1 < LINEAGE_MIN_SHARED_COMPONENTS=2 → isolation HOLDS)
lineage isolation:      {"ok":true,"hits":[]}
evaluated commit:       f2432d178…    verifier cwd: …/pin-f2432d178
lineage_ok: true   temporal_ok: true
predicted verdict: "refuted"   expected: ["supported"]   correct: false   promoted: NO
candidate status after: retired
retirement_reason: failed-generalization-on-HX-scope-memorymax-literal-vs-host-derived: predicted-refuted-but-role-found-and-fixed-requires-supported
verdict_ref: generalization_verdict-45bae92d1286dc65     model call: 20 turns, $1.389213 (CLI)
```

### Verdict 3 (third positive held-out, NOT evaluated) — `carrier-persistence-check@3` × `HX-reflog-empty-action-producer-vs-classifier`

```
candidate lineage: carrier-persistence-check@1,2,3
candidate provenance: ["experience-2519951c56dc2990"]
seed subject components: docs/analysis/discovery-experience-ledger.mjs
held-out id:            HX-reflog-empty-action-producer-vs-classifier      label role: holdout-H
held-out components:    plugin/scripts/integration-batch-merge.ts, plugin/scripts/direct-to-develop-bypass-check.ts
lineage isolation:      {"ok":true,"hits":[]}     shared with seed: []
evaluated commit:       (null — no verdict was produced)   verifier cwd: /data/home/yale/work/quay-scratch/dm-regression/pin-f2432d178
outcome: not-evaluated    not_evaluated_reason: "UNPARSEABLE_MODEL_OUTPUT"
stream result subtype:  "error_max_turns" (15 turns)   → candidate stays DRAFT, promoted: NO
```

### Verdict 4 (the negative held-out) — `non-substantive-verdict-triage@8` × `HX-neg-cpu-stall-readers-different-source`

```
held-out id:            HX-neg-cpu-stall-readers-different-source   label role: holdout-negative
held-out components:    plugin/scripts/suite-load-sampler.ts, plugin/scripts/cap-from-gate.ts
lineage isolation:      {"ok":true,"hits":[]}
temporal_ok: null       (a non-positive case names no fix_commit — the gate was NOT evaluated, not passed)
evaluated commit:       f2432d178…    verifier cwd: …/pin-f2432d178
predicted verdict: "supported"   expected: ["refuted"]   correct: false   promoted: NO
retirement_reason: failed-generalization-on-HX-neg-cpu-stall-readers-different-source: predicted-supported-but-role-confirmed-negative-requires-refuted
verdict_ref: generalization_verdict-ff7d5d31d9b7d2cf     model call: 15 turns, $0.768762 (CLI)
```

**Reading.** Three of the four candidates were graded on real held-out cases, at the pin, in a stripped
tree, with the lineage and temporal gates visibly passing (`lineage_ok:true`, `temporal_ok:true` on the
fix-bearing cases) and the `evaluated_commit` recorded. **None promoted.** That is the honest outcome:
the methods this round produced are about the *discovery pipeline's own bookkeeping* (verdict-reason
triage, carrier path resolution) — not about the E-DT-1 architecture cases they were shown — so a blind
verifier asked “does this method's invariant hold here?” answered `refuted` on the two positive cases.
The one candidate whose subject genuinely overlaps a holdout
(`composite-subject-verdict-decomposition`, sharing `full-suite-runner.ts`) also failed.

---

## AC4 — Failing method not promoted, real

Two candidates were graded and **wrong**; both were retired with a reason and neither is in
`activeMethods()`:

```
method_id                                version status   retirement_reason
non-substantive-verdict-triage           v9      retired  failed-generalization-on-HX-needs-human-transition-three-copies:
                                                          predicted-refuted-but-role-found-and-fixed-requires-supported
composite-subject-verdict-decomposition  v2      retired  failed-generalization-on-HX-scope-memorymax-literal-vs-host-derived:
                                                          predicted-refuted-but-role-found-and-fixed-requires-supported

appended: {"ok":true,"appended":true,"id":"method-a073630f32ddbd58"} / {"ok":true,"appended":true,"id":"method-41ce41e4cdfd93f2"}
```

The third candidate did not reach a verdict at all, and is `draft` — the AC's own escape
(“or `draft` if not-evaluated”):

```
carrier-persistence-check@3   outcome=not-evaluated   status after: draft   promoted: false
```

and the **bare-promotion negative control** — a `status:"active"` record with no cited verdict — is refused,
so “failing” cannot be reached by simply asserting `active`:

```
{"ok":false,"appended":false,"reasons":[
 "PROMOTION_WITHOUT_VALID_GENERALIZATION:EVIDENCE_MISSING:status=active-must-carry-generalization_evidence.verdict_ref-naming-a-recorded-validateGeneralization-verdict"]}
```

---

## AC5 — Quarantine holds

```
activeMethods(root) → {"ok":true,"evaluated":4,"methods":[],"file":"/data/home/yale/work/quay/.quay/discovery-method-registry.jsonl",
                       "contains_shared_contract_divergence": false}
```

`shared-contract-divergence` is absent at **every** version: v1 is `draft` (superseded) and v2 is `retired`,
carrying the quarantine reason written by `gap-discovery-carriers-ephemeral-in-worktree`:

```
v2 retired:
"promoted on INVALID evidence (verdict generalization_verdict-9015f19c07ec161c): LINEAGE LEAK — the held-out case
 was the v1 seed (the same evidence-store record the method was fitted on), and TEMPORAL MISMATCH — the verifier
 read post-fix code while the case's label is pre-fix. Retired; it must not be re-promoted on this evidence."
```

Re-promoting it **citing that old verdict** is refused — the rule reads the *recorded* verdict, not the claim:

```
attempt: append shared-contract-divergence v3 status:"active" generalization_evidence.verdict_ref = generalization_verdict-9015f19c07ec161c
recorded verdict: {outcome:"not-evaluated", correct:null, refusal_code:"HELD_OUT_SHARES_LINEAGE", lineage_ok:false, temporal_ok:false}
result: {"ok":false,"appended":false,"reasons":[
 "PROMOTION_WITHOUT_VALID_GENERALIZATION:VERDICT_NOT_PASSED:generalization_verdict-9015f19c07ec161c-recorded-outcome=not-evaluated-correct=null-refusal_code=HELD_OUT_SHARES_LINEAGE-lineage_ok=false-temporal_ok=false"]}
activeMethods() after the attempt → []
```

---

## AC6 — Cost

Rates are read from the gateway, not assumed:

```
$ curl -s -H "Authorization: Bearer <key from ~/.local/etc/fjdac-api-key>" http://127.0.0.1:26510/model_group/info
model_group "v4.1flash-anthropic": providers ["deepseek"],
  input_cost_per_token  3e-07     ($0.30 / M)
  output_cost_per_token 1.2e-06   ($1.20 / M)
  max_input_tokens 1000000        max_output_tokens 393216
```

> Note on the key file: `~/.local/etc/fjdac-api-key` is a shell **snippet** (`# comment` + `export
> FJDAC_API_KEY="sk-…"`). Piping it raw into an `Authorization:` header splits the request across lines and
> every route answers `400 Invalid HTTP request received.`; the token must be extracted first. Reported
> because it cost a detour, not because it is a defect.

Model calls / tokens / wall clock (all from the `modelCallFields` projection of the stream's `result` event
and the gateway's `modelUsage` block — read, not guessed):

| arm | calls | input | output | cache_read | cache_creation | wall ms | CLI `cost_usd` | gateway recompute | ratio |
|---|---|---|---|---|---|---|---|---|---|
| reflect batch 1 | 24 | 554 433 | 32 405 | 0 | 0 | 246 657 | **3.582290** | 0.205216 | 17.5× |
| reflect batch 2 | 16 | 378 066 | 30 929 | 0 | 0 | 220 249 | **2.663555** | 0.150535 | 17.7× |
| verifiers (`validateGeneralization`) | 4 | 258 739 | 74 545 | 2 450 048 | 0 | 511 249 | **4.382344** | 0.902090 | 4.9× |
| **final run total** | **44** | **1 191 238** | **137 879** | **2 450 048** | 0 | **978 155** | **10.628189** | **1.257841** | **8.5×** |

Recomputation formula and its control:

```
billed_input = input + cache_read + cache_creation = 3 641 286
usd  = billed_input * 3e-07 + output * 1.2e-06                        = 1.257841
usd (narrow control: input only, cache tokens EXCLUDED)               = 0.522826
```

**The CLI figure is a fallback guess, and this run measures how far off it is**: the CLI charged
$10.628189 for 44 calls while the gateway's own published rates price the same tokens at $1.257841 — an
8.5× overstatement on the reflect calls (17.5×) and 4.9× on the verifier calls. The premise in the task's
Plan that the CLI marks this `costBasis: "unknown"` **does not hold on this CLI version (claude 2.1.296)**:
the stream `result` event carries **no `costBasis` key at all**; it carries `total_cost_usd` and a
`modelUsage` block whose `costUSD` is the same figure:

```
{"subtype":"success","num_turns":9,"total_cost_usd":0.558812,
 "modelUsage":{"v4.1flash-anthropic":{"inputTokens":43633,"outputTokens":11071,"cacheReadInputTokens":127744,
                                      "costUSD":0.558812,"canonicalModel":"v4.1flash-anthropic", …}}}
```

Exploration (batch scoping — 20 `reflect` calls run before the batch rule was fixed; **not** part of the
final run): 20 calls, 462 404 input / 31 580 output / 0 cache_read, 227 074 ms, CLI `cost_usd` 3.101520,
gateway recompute 0.176617. Including the smoke test, the single-unit probe and the 4-call first attempt,
the whole exercise cost ≈ **$14.5 by the CLI's figure / ≈ $1.7 at the gateway's published rates**.

---

## AC7 — `learning_quality` and `net_new_discovery_value`

```
learningQuality(valid held-out verdicts only) = {"value":0,"evaluated":3,"correct":0,"not_evaluated":1}
   → 3 verdicts were evaluated (1 positive ×2 candidates + 1 negative), 0 predicted the held-out role;
     the 4th call was NOT evaluated (turn-budget exhaustion → UNPARSEABLE_MODEL_OUTPUT) and is excluded
     from numerator AND denominator, counted in `not_evaluated`.
net_new_discovery_value = "not-yet-measured"   (NET_NEW_DISCOVERY_VALUE; never 0 — it needs an ACTIVE
   method finding something in production OUTSIDE its own seed provenance, which requires the follow-on
   routine-wiring task)
```

---

## Findings — what this regression actually shows

**The four fixes each hold, individually and together.** Every one is exercised on real data above:
lineage isolation passed with the shared-component count printed (`1 < 2`); the temporal gate read the pin
and refused nothing spuriously while recording `evaluated_commit`; carriers resolved to the shared checkout
from a worktree; the tool≠subject rule refused five candidates whose text named a seed; and a bare
`active` is refused twice over (`EVIDENCE_MISSING`, and `VERDICT_NOT_PASSED` against the old verdict).

**But the loop no longer learns anything about the code it inspects.** This is the regression's headline.
`ingestNewOutcomes` derives every Experience field from the record, and the derived `summary` is a
*projection* — `"<experiment_ref>: verifier verdict \"<verdict>\" on subject <subject_key>"` — which never
states what the defect was. Reflection sees only that projection, so **24 of 40 units answered
`no-method`** — among them three of the four units the Plan names as seeds: the fan-in lock, REQUIRED_FIELDS
and C7 all returned `no-method`; C5 returned `new`, and that candidate was then refused
(`METHOD_TEXT_NAMES_SEED`) because its text named its own subject files. The model's own reason for the
fan-in unit, verbatim: *“The Experience is a bare verifier verdict ('supported') over a subject-key listing
three plugin scripts, plus an opaque outcome id. It carries no observed defect, no refuted hypothesis, and no
described procedure — nothing in the text states what was done, what was inspected, or what invariant was
checked, so no HOW-TO-LOOK step can be extracted that would transfer to any other finding.”* The only units that DID yield
candidates are ones whose summaries carry a `[reason: …]` clause (TURN_LIMIT) or that were human-written —
and the resulting 11 candidates are **methods about the discovery pipeline itself** (verdict-reason triage,
carrier path resolution), not about the E-DT-1 architecture cases. The fix that removed hand-narration
therefore also removed the material reflection needs; the loop can still *run*, but it currently learns
about its own instrument rather than about the system under study.

**Nondeterminism makes a single round's `learning_quality` unstable.** The same units decided differently
across repeats with the same prompt and the same registry: `EXP-696a9770477e60e0` (C5) was `no-method` in
the widening pass and `new` in the final pass; `EXP-bb12a6858838e74b` (REQUIRED_FIELDS) was
`extends shared-contract-divergence` in the widening pass and `no-method` in the final pass. A metric read
off one round is a sample, not a measurement — it must be aggregated over rounds before it means anything.

**The generalization gate has no APPLICABILITY gate.** `validateGeneralization` asks the verifier “does
this method's invariant hold here?” against any held-out case it is handed, with no check that the method's
applicability covers the case's subject. Every candidate above was graded against an architecture case it
was never about. In this run that produced honest `refuted`/`supported` mismatches and retirements, which is
the desired direction — but the mechanism is symmetric: for a **negative** held-out case (expected
`refuted`), a method that does not apply can answer “the invariant is not violated here” and be graded
**correct**, promoting a method on a case it does not describe. Not observed in this run (the one negative
test predicted `supported` and was retired); recorded because the rule as written permits it.

**A turn-budget exhaustion is reported as `UNPARSEABLE_MODEL_OUTPUT`.** Verdict 3's stream carries the
structural signal `subtype:"error_max_turns"` (15 turns), but `validateGeneralization` parses only
`parseJsonObject(callText(stdout))` and reports the failure as “unparseable”, collapsing “the verifier ran
out of turns” into “the model output was garbage”. The hypothesis-generation stage already has
`verifierVerdict`, which maps exactly this subtype to `TURN_LIMIT` (硬规则 3b: “I could not evaluate this”
should say *which way* it failed). The candidate still correctly stayed `draft` — only the *reason* is
coarser than the data supports.

**The versioning contract lets one method become a swarm.** Seven successive `extends` decisions produced
`non-substantive-verdict-triage` v1…v8 in one run, all restatements of one idea; a ninth followed from the
generalization round. The append-only contract is sound, but “prefer `extends` against an existing registry
method” combined with an always-present registry makes the registry drift toward one method — the same
limitation the Phase-2 task recorded, now observed at scale.

---

## Deviation from the Plan, stated rather than papered over

The Plan says **ONE** bounded `reflect()` round. This run executed **two** bounded batches under one stated
budget. Reason, from the run itself: batch 1 (the 3 AC3-named holdout neighbourhoods) produced three
candidates, **none of whose subject set overlaps a positive hold-out case**, so the Proposal's first
requirement — “a cross-case generalization with NO shared ancestry” — could not be exercised at all. Batch 2
added the two remaining holdout neighbourhoods, which produced the candidates Verdicts 1–2 were run
against. Both batches, their rules and their costs are stated above; nothing was hand-picked per candidate.

## Reproduction

```bash
WT=/data/home/yale/work/quay-worktrees/gap-discovery-method-loop-independent-regression
# 1. ingest (from the worktree; carriers land in the shared checkout)
node <runner> stage1-ingest.mjs
# 2. one bounded reflect() round, candidates persisted as draft
node <runner> stage2c-reflect.mjs          # batch 1
node <runner> stage2d-reflect-round2.mjs   # batch 2
# 3. held-out verdicts at the pin, in a stripped tree
node $WT/docs/analysis/discovery-reflection.mjs --help   # CLI: `reflect --root <dir>`
#    the verifier seam launches: hardenedArgv(launchArgv, prompt, $WT, {tools:"Read,Grep", maxTurns:14,
#    outputFormat:"stream-json"}) with process.cwd() = the stripped pin dir
```

`materializeStrippedPin` is the entry point for the pin; `gitIsAncestor($WT)` is the ancestry seam;
`readGeneralizationVerdicts` re-reads what the verifier recorded.
