# Discovery capability gain — same-budget control vs learned-methods arm

**Question (Plan point 3 / (C), 2026-10-12 strategy change):** do learned methods add NET-NEW findings
in *real open exploration*, at the same budget as a method-free control?

**Answer.** On the pre-registered rule the learned arm produced **2 net-new findings against the
control's 1 — a gain of +1** — but the operator re-check collapses that to **0 confirmed net-new
defects**: the learned arm's second finding is the control's own finding restated over a wider
component set, and its third re-states a *refuted* mechanism and lands on a divergence that the code
declares and its tests pin as deliberate. Coverage grade change is **0**. Gateway cost difference is
**−$0.035** (the learned arm was marginally cheaper). The full statement, including what this does NOT
establish, is §9.

All numbers below are read from the recorded artifacts under `/data/home/yale/work/quay-scratch/gain1/`
(named per section). Nothing here was re-run to improve a reading.

---

## 1. Design and pre-registration

Pre-registration: `/data/home/yale/work/quay-scratch/gain1/prereg.json`, sha256
`7b286c57a3837967333de2b902ad3df99b14cd18e95ccbd85145fb283181922e`, `chmod 444`.

| event | mtime |
|---|---|
| `prereg.json` written | **2026-10-12 21:52:18 +0800** |
| first model call (`runs-CTRL/run-1.json`) | 2026-10-12 21:53:38 +0800 |
| `runs-LEARN/run-1.json` | 2026-10-12 21:55:48 +0800 |
| `verify-CTRL/verify.json` | 2026-10-12 22:00:45 +0800 |
| `verify-LEARN/verify.json` | 2026-10-12 22:03:49 +0800 |

The pre-registration predates every run file by 80 s or more. The tool enforces this itself: `verify`
refuses the whole pass with `PREREG_NOT_OLDER_THAN_RUNS` if it does not hold, and both arms exited 0.

**Identical budget, both arms** (the parameters as pre-registered):

| knob | value |
|---|---|
| model | `v4.1flash-anthropic` (`models["model-CTRL"]` / `["model-LEARN"]` in the prereg) |
| pin | `2e5b0359813b397f04300ef5e1c8aafb075d327f` (develop at run time) |
| scope | `plugin/scripts/*.ts` (285 components) |
| inventory | `inventory-neutral.txt`, sha256 `54bc2387482fc419ea76a455f2568abcb737fd7cb70e42fda75a0f76036bb1d9` — **the same bytes for both arms** |
| investigator runs per arm | 2 |
| investigator isolation | `--tools ""` + process cwd = an EMPTY neutral dir |
| verifier cluster cap per arm | 15 (the tool's hard ceiling) |
| verifier turns / timeout | 8 turns / 300 000 ms per call |
| verifier strategy | `default` (frozen `verifier.txt`, sha256 `dba2e67157aac12ccb769fe10bfa75fb91cfe8955cf9eca66b71301f01981f2d`) |
| verifier pin tree | the same stripped tree (`docs/`, `tasks/`, `goals/`, `orchestration/`, `.quay/`, `archive/`, `milestones/`, `measurements/` removed) |

The two arms differ in exactly one artifact: the investigator prompt.

| arm | investigator prompt | sha256 | Δ bytes |
|---|---|---|---|
| CTRL | `prompt-control.txt` = `investigator-round1-frozen.txt` verbatim | `19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea` | 0 |
| LEARN | `prompt-learned.txt` = the same file + one `LEARNED METHODS` block inserted before `INVENTORY:` | `4fca7b870b13a2917e5835c7061d59c72c62dd4d3c866505892bf54f5b471489` | +1138 |

## 2. The method set (mechanical, not chosen)

Rule, applied by `prep.mjs` over `readMethodRegistry(sharedCheckout).latest` (5 latest versions):

1. exclude `status === "retired"`;
2. exclude a record whose **lineage** is quarantined (`quarantinedLineageOf`);
3. exclude a record whose promoting `verdict_ref` is on `.quay/discovery-contaminated-verdicts.jsonl`.

`non-retired` is read literally: the status vocabulary is `draft | trial | active | retired`, and
`quarantined` is a property of a lineage, not a status (`discovery-method-registry.mjs`
`METHOD_STATUSES`). At this pin **there is no `active` and no `trial` method** — the four that were ever
promoted were retired earlier the same day.

**Included (1):**

| method_id | version | status |
|---|---|---|
| `carrier-persistence-check` | 3 | draft |

**Excluded (4), mechanically:**

| method_id | version | status | reason (verbatim head) |
|---|---|---|---|
| `composite-subject-verdict-decomposition` | 2 | retired | `failed-generalization-on-HX-scope-memorymax-literal-vs-host-derived: predicted-refuted-but-role-found…` |
| `multi-writer-guard-equivalence` | 3 | retired | `QUARANTINE 2026-10-12 (operator, user-authorized): v2 was promoted on contaminated holdout…` **+ quarantined lineage** |
| `non-substantive-verdict-triage` | 9 | retired | `failed-generalization-on-HX-needs-human-transition-three-copies: predicted-refuted-but-role-found…` |
| `shared-contract-divergence` | 7 | retired | `QUARANTINE 2026-10-12 (operator, user-authorized): v6 was promoted on contaminated holdout…` **+ quarantined lineage** |

The learned-arm method text is `operation.steps` + `applicability` of the one included method only —
836 bytes, sha256 `ab320693a9fb181165ca7f2d87486f7b8a1c124e37263c6f9b5ecc07dca2e0f1`. **The learned arm
therefore carries one method about *root derivation and write persistence* — not about duplicated
vocabularies, which is what both arms ended up finding.** That mismatch is a property of the registry,
not of the run, and it bounds what this experiment can show (§9).

## 3. Anti-leak scan (the existing mechanism, not a new one)

The scan is the ledger's own deny-list, via `experienceDenyList(root, {scanText})` →
`scanExperienceLeak` (`discovery-experience-ledger.mjs`), not a re-implementation. The deny-list was
READ, not assumed: `ok:true`, 118 ledger records → **195 component basenames + 118 case ids**, 0
malformed lines.

| text scanned | flagged | matches |
|---|---|---|
| **the learned-arm prompt alone** (the only bytes the method set contributes) | **false** | **0** |
| learned prompt + inventory | true | 193 |
| control prompt + inventory | true | 193 |
| set-difference (learned minus control) | — | **0** |

The 193 matches are the *inventory naming its own subjects* — identical in both arms, because the
inventory is byte-identical. The learned-arm prompt contributes **zero** seed components and **zero**
case ids. Raw scan: `anti-leak-scan.json`.

## 4. Results per arm

### 4.1 Investigator (identical budget)

| | CTRL | LEARN |
|---|---|---|
| runs parsed / requested | 2 / 2 | 2 / 2 |
| hypotheses | 24 | 24 |
| wall ms | 134 479 | 127 633 |
| requested model | `v4.1flash-anthropic` | `v4.1flash-anthropic` |
| actual (stream init) model | `v4.1flash-anthropic` | `v4.1flash-anthropic` |
| model mismatch | false | false |
| input tokens | 76 750 | 77 220 |
| output tokens | 25 803 | 24 736 |
| gateway cost | **$1.028825** | **$1.004500** |

### 4.2 Verifier (identical budget)

| | CTRL | LEARN |
|---|---|---|
| clusters formed | 20 | 19 |
| verified (cap 15) | 15 | 15 |
| beyond cap (unverified) | 5 (c16–c20) | 4 (c16–c19) |
| supported | 2 | 2 |
| refuted | 5 | 0 |
| undetermined | 8 | 13 |
| of the undetermined: turn limit | 7 | 13 |
| of the undetermined: unparseable | 1 | 0 |
| verifier turns used | 216 | 226 |
| input tokens / cache-read / output | 514 795 / 2 076 544 / 114 118 | 582 719 / 2 370 048 / 94 242 |
| gateway cost | **$6.465197** | **$6.454669** |
| rows accepted / refused by the validator | 20 / 0 | 15 / 0 |

### 4.3 Scoring (pre-registered rule)

A verified cluster is **net-new** iff `verdict == supported` **and not intentional** **and** it matches
no earlier portfolio record (`findDuplicate`: same component set + same normalized claim) **and** no
task on `develop` lists ≥2 of its components in `## Touches`.

| | CTRL | LEARN | gain (LEARN − CTRL) |
|---|---|---|---|
| supported | 2 | 2 | 0 |
| — of which intentional (verifier-judged) | 1 | 0 | −1 |
| — of which duplicate (task/portfolio dedup) | 0 | 0 | 0 |
| **net-new** | **1** | **2** | **+1** |
| refuted | 5 | 0 | −5 |
| undetermined | 8 | 13 | +5 |
| net-new per gateway dollar | 0.1334 | 0.2681 | +0.1347 |
| gateway cost | $7.494022 | $7.459169 | **−$0.034853** |

Scored rows: `scored.json`.

## 5. The net-new findings, and the operator check of each

### CTRL — 1 net-new

**`GAIN1-CTRL-c10`** · `invariant` · components `plugin/scripts/self-report-vocab-audit.ts`,
`plugin/scripts/self-report-vocab-check.ts` · verifier `supported`, `intentional:false`, 15 turns.

> The same reanchor-convergence invariant is implemented twice as two live, independently-dispatching
> detectors with genuinely divergent pattern sets (batch-of digit requirement, batch-id lookahead),
> divergent inner-self-report definitions (commit subject filter vs caller lines), and divergent
> convergence units (newest-3-reports in one scan vs persisted 3-clean-ticks), so the same inner report
> can be flagged by one and clean by the other.

**Operator check — CONFIRMED DEFECT.** Read at the pin:
`self-report-vocab-audit.ts:76-80` `BATCH_FLAG_PATTERNS[0]` is `/\bBatch\s+of\b/i` (**no digit
required**); `self-report-vocab-check.ts:40-45` `BATCH_SELF_REPORT_PATTERNS[0]` is
`/\bBatch\s+of\s+\d+\b/i` (**digit required**). The two modules share the declared concept and the task
id `gap-reanchor-must-converge-inner-self-reported-vocabulary`, import nothing from each other, and
the audit scans caller-supplied lines while the check scans commit subjects via `/^(inner:|merge )/`.
Divergence, one line: the text `Batch of fully merged` flags in the audit and is clean in the check.

### LEARN — 2 net-new

**`GAIN1-LEARN-c11`** · `invariant` · components `plugin/scripts/pane-state-classify.ts`,
`plugin/scripts/self-report-vocab-audit.ts`, `plugin/scripts/self-report-vocab-check.ts`,
`plugin/scripts/semantic-observer-judge.ts` · verifier `supported`, `intentional:false`, 14 turns.

> `self-report-vocab-audit.ts` and `self-report-vocab-check.ts` implement the same declared concept
> (inner self-report batch-vocabulary convergence, same task id) with fully disjoint pattern tables,
> disjoint convergence accounting, and no cross-import, while `semantic-observer-judge.ts` and
> `pane-state-classify.ts` each carry yet another independent phrase/shape table for the
> stopped-versus-busy reading.

**Operator check — the SAME finding as CTRL c10, not an additional one.** The two core components are
identical and the confirmed divergence is the identical pair of regexes. LEARN c11 is a strict
**superset** of CTRL c10: it adds `pane-state-classify.ts` and `semantic-observer-judge.ts`. The
inter-arm difference is *wider component attribution for one finding*, not a second finding.

**`GAIN1-LEARN-c13`** · `identity` · components `plugin/scripts/anti-drift-touches-check.ts`,
`plugin/scripts/fan-in-ts-typecheck-gate.ts`, `plugin/scripts/touches-orthogonality-check.ts`,
`plugin/scripts/touches-parser.ts` · verifier `supported`, `intentional:false`, 10 turns.

> The bullet→path parse is genuinely single-sourced in `touches-parser.ts` (the hypothesis's stated
> mechanism is wrong), but the ts-typecheck gate's separate glob-set normalization and `touchCoversFile`
> prefix matcher give different "does this change touch file X" answers than the anti-drift gate and
> scheduler, which share `matchGlob` — the divergence the claim predicts is real, located in the matcher
> rather than the parser.

**Operator check — NOT CONFIRMED as a defect; the stated mechanism is refuted.**

- The investigator's stated mechanism ("the parse is implemented independently") is **false**. Every
  cited module imports the one parser: `fan-in-ts-typecheck-gate.ts:48`,
  `touches-orthogonality-check.ts:36`, `anti-drift-touches-check.ts:64` (via `parseTouches` from the
  orthogonality module, which itself calls `extractTouchesSection`/`parseTouchEntries`) — and
  `plugin/test/touches-parser-parity.test.mjs` asserts every parser yields an identical path set. This
  is the same refuted shape as the portfolio's existing record `N01`.
- The verifier's **re-located** mechanism is real and operator-demonstrated on a real Touches shape
  (152 of 15 237 Touches entries carry a single `*`): `touchCoversFile("plugin/scripts/*candidate*",
  "plugin/scripts/candidate-foo.ts")` → `false`, `matchGlob("plugin/scripts/*candidate*",
  "plugin/scripts/candidate-foo.ts")` → `true`.
- But it is **documented and test-pinned**: `fan-in-ts-typecheck-gate.ts:72-73` states the
  "trailing `/*`/`/**` → directory prefix" rule, and
  `plugin/test/fan-in-ts-typecheck-gate.test.mjs:100` pins `touchCoversFile("src/*", "src/cli/import.ts") === true`.
  A divergence a module declares and its test fixes is design, not drift. Whether the *under-coverage*
  of inner-wildcard globs (`*candidate*`, `packages/*/package.json`) is a defect worth a fix task is a
  judgement this experiment does **not** settle — see §9.

## 6. Portfolio records (AC: every net-new finding, `evidence_level:"production-open"`)

Appended to `.quay/discovery-portfolio.jsonl` (shared checkout) via the module's own
`ingestExperience` + `ingestFinding`; each carries a resolvable `origin_ref` — an Experience minted for
that cluster. Records (field-trimmed; the carriers hold the full rows):

```json
{"kind":"portfolio_finding","id":"portfolio_finding-18e675aff86564f8","finding_id":"GAIN1-CTRL-c10","origin":"autonomous-experiment","origin_ref":"GAIN1-CTRL-c10","evidence_level":"production-open","method_ref":null,"outcome":"supported","components":["self-report-vocab-audit.ts","self-report-vocab-check.ts"],"fix_task":null,"duplicate_of":null}
{"kind":"portfolio_finding","id":"portfolio_finding-b0a19a72818c6dde","finding_id":"GAIN1-LEARN-c11","origin":"autonomous-experiment","origin_ref":"GAIN1-LEARN-c11","evidence_level":"production-open","method_ref":null,"outcome":"supported","components":["pane-state-classify.ts","self-report-vocab-audit.ts","self-report-vocab-check.ts","semantic-observer-judge.ts"],"fix_task":null,"duplicate_of":null}
{"kind":"portfolio_finding","id":"portfolio_finding-21d4e4db293b2027","finding_id":"GAIN1-LEARN-c13","origin":"autonomous-experiment","origin_ref":"GAIN1-LEARN-c13","evidence_level":"production-open","method_ref":null,"outcome":"supported","components":["anti-drift-touches-check.ts","fan-in-ts-typecheck-gate.ts","touches-orthogonality-check.ts","touches-parser.ts"],"fix_task":null,"duplicate_of":null}
```

`fix_task` is `null` on all three. The Plan says the operator files real fix tasks for confirmed
defects; this worker's declared `## Touches` are the task file and this report, so a new
`tasks/gap-….md` would land **outside the declared write surface** and red the fan-in anti-drift HARD
check. The confirmed defect (CTRL c10 / LEARN c11) is therefore recorded here and in the portfolio, and
filing the fix task is left to the next round:

> **Candidate fix task** — `gap-self-report-vocab-audit-check-pattern-tables-diverge`: the audit and
> check modules declare the same concept with divergent batch-of/batch-id patterns and divergent
> convergence accounting; single-source the pattern tables and the inner-self-report filter, or make
> one delegate to the other.

## 7. Coverage grade change (AC)

`coverageMap(sharedCheckout)` before / after adding the three findings — `coverage-before.json`,
`coverage-after.json`. Findings 13 → 16; **every grade unchanged and the gap list unchanged**:

| domain | before | after |
|---|---|---|
| shared semantics | autonomous | autonomous |
| config→behavior | assisted | assisted |
| writer/checker contract | autonomous | autonomous |
| state transitions | assisted | assisted |
| reuse refutation | autonomous | autonomous |
| method trustworthiness | none | none |

gap before `["config-to-behavior","state-transitions","method-trustworthiness"]`; gap after: the same.

**Coverage grade gain = 0.** All three findings land in `shared-semantics`, which was already
`autonomous`. This is the expected arithmetic: the coverage map grades *which domains* are covered, and
this experiment adds depth inside a domain, not coverage of a dark one.

## 8. Gain, stated as a number (AC)

| quantity | CTRL | LEARN | gain |
|---|---|---|---|
| net-new findings (pre-registered rule) | 1 | 2 | **+1** |
| net-new per gateway dollar | 0.1334 | 0.2681 | **+0.1347** |
| coverage grade changes | 0 | 0 | **0** |
| gateway cost (USD) | 7.494022 | 7.459169 | **−0.034853** |

## 9. Honest outcome statement (AC)

**The gain is not a demonstrated capability gain.**

1. **On the pre-registered count the gain is +1, and that +1 does not survive operator re-check.**
   The learned arm's extra net-new finding (`LEARN c11`) is the control's finding (`CTRL c10`) with two
   more components attached — the identical divergence, the identical two regexes. Counting them as two
   is an artifact of the pre-registered rule counting *clusters*, not *distinct defects*. On a distinct
   *confirmed* defect basis the two arms are **tied at 1 each: gain = 0**.
2. **The learned arm's other supported finding (`LEARN c13`) rests on a refuted mechanism.** The
   investigator's claim was false; the verifier rescued it by re-locating the divergence to a *different*
   layer, and that divergence is documented in the code and pinned by its test. It is in the portfolio
   because the pre-registered rule admits it, not because the operator confirmed a defect.
3. **The method set that could be learned from is nearly empty, and orthogonal to what was found.**
   After the mechanical exclusion there was ONE non-retired method (`carrier-persistence-check` v3,
   *draft*), about root derivation and write persistence. Both arms found duplicated *vocabularies and
   matchers*. The learned arm's one extra cluster is not visibly attributable to that method, and this
   experiment has no design that could attribute it — there is one method, no ablation of it, and the
   control also found the same core finding.
4. **The cost difference is noise, not a saving.** −$0.035 on $7.46 is 0.5 %. The verifier's token mix
   differed in the other direction in the same measurement (LEARN: more input, more cache-read, fewer
   output tokens), so the sign is not stable.
5. **The measurement is capped.** 5 of 20 control clusters and 4 of 19 learned clusters were never
   verified (the tool's hard cap is 15 per arm) — 23 % of the control's clusters are simply unknown, and
   an unverified cluster is not evidence either way. The learned arm also produced 13 undetermined
   clusters against the control's 8, all but one at the turn limit: **the learned arm's hypotheses were
   harder to settle within the same budget, which is a cost, not a gain** — the same budget bought fewer
   verdicts.
6. **No negative was chased away.** No run was repeated, no cluster re-verified, no arm re-run. The
   reported net-new counts are the first and only pass. The only post-hoc work was (a) reading the code
   behind each net-new cluster, and (b) one instrumentation repair (§10) that moved already-recorded
   outcome records to the store the ingest path reads.

**What this does NOT establish.** "Learned methods add no net-new findings" is *not* shown. What is
shown is that *this* learned arm — one draft method, about a different defect class, with a same-budget
verifier that also had to settle more undetermined clusters — added nothing that survives inspection.
The right follow-up is a method set that actually bears on the observed defect classes, and a per-method
ablation, before the capability question is asked again.

## 10. Reproduction

```
# pre-registration (predates every run) and the two arms
/data/home/yale/work/quay-scratch/gain1/prereg.json            sha256 7b286c57…  chmod 444

node docs/analysis/arch-hypothesis-generation.mjs inventory --pin 2e5b0359… --inventory-form neutral \
  --out   …/inventory-neutral.txt     # 285 components, sha256 54bc2387…

node … investigate --inventory …/inventory-neutral.txt --neutral-dir <empty> \
  --investigator-prompt …/prompt-{control,learned}.txt --model v4.1flash-anthropic \
  --runs 2 --max-runs 2 --timeout-ms 300000 --out-dir …/runs-{CTRL,LEARN}

node … verify --pin-dir …/pin --runs …/runs-{CTRL,LEARN} --inventory …/inventory-neutral.txt \
  --investigator-prompt …/prompt-{control,learned}.txt --prereg …/prereg.json --arm {CTRL,LEARN} \
  --experiment E-GAIN-1-{CTRL,LEARN} --model v4.1flash-anthropic --write-store \
  --run-count 2 --max-clusters 15 --max-turns 8 --timeout-ms 300000     # cwd MUST be the pin dir
```

Scored by `score.mjs` (open-domain dedup against `develop`'s `tasks/*.md` `## Touches` and the existing
portfolio), then projected by `collect.mjs`. One instrumentation note, stated plainly: `verify
--write-store` appends to `storeFile(root)` where `root` is the *tool's* resolved root, so the 30
E-GAIN-1 outcome records first landed in this worktree's local `.quay/architecture-evidence-store.jsonl`
rather than the shared store that `resolveOutcomeForIngest` reads. `collect.mjs` re-appends exactly
those 30 records to the shared store through the store's own `appendRecord` — the call `emit` makes —
and then runs the normal ingest. No model call was made in that repair.
