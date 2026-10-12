---
id: gap-discovery-coverage-map-from-findings
title: Capability Coverage Map over user-named domains, graded only by concrete
  findings + operations (prompt/teaching mentions never count)
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-portfolio-value-evidence-ledger
---
## Proposal
(B) of the 2026-10-12 strategy change: a Capability Coverage Map over the domains the user named:
- shared semantics;
- config→behavior;
- writer/checker contract;
- state transitions;
- reuse refutation;
- method trustworthiness.

A domain counts as covered only by concrete evidence: a portfolio Finding plus the investigation operation that produced it. It never counts because a case appeared in a prompt, a seed or a teaching set.

The operator baseline (`/data/home/yale/work/quay-scratch/portfolio-demo/REPORT.md`) suggests:
- autonomous coverage exists for shared semantics (F02, F03, F04, F06), writer/checker contract (F01, F05) and reuse refutation (N01);
- config→behavior and method trustworthiness are covered only by operator work;
- state transitions have no autonomous hit: the blind run mispredicted `HX-needs-human-transition-three-copies`.

## Plan
1. In `docs/analysis/discovery-portfolio.mjs`, add `coverageMap(root)`. It is derived, not stored, from `.quay/discovery-portfolio.jsonl` and the method registry. For each domain it reports:
   - findings by origin and evidence level;
   - the operations that produced them (verifier call, routine probe, instrument);
   - methods whose `applicability` claims the domain, with their trust state (active/draft/retired, contaminated or not);
   - a coverage grade: `autonomous` (≥1 supported autonomous `independent`/`production-open` finding with a landed fix), `assisted` (operator/user/teaching only), or `none`.
2. A finding gets its domain from an explicit `domain` field on the portfolio record, set at ingest with a reason. A missing domain ⇒ `unclassified`, reported, never guessed.
3. A case named only in a prompt, seed, sealed label or teaching Experience never raises a grade. The map refuses evidence whose `evidence_level` is `teaching` for the `autonomous` grade.
4. Retired or contaminated methods contribute no coverage.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-portfolio.test.mjs` exits 0 with new cases:
  - (a) a teaching-level supported finding yields `assisted`, never `autonomous`;
  - (b) a contaminated or retired method adds nothing;
  - (c) an unclassified finding is reported as `unclassified`;
  - (d) one autonomous production-open supported finding with a landed fix yields `autonomous`.
- [x] Real map from the production portfolio (requires `gap-discovery-portfolio-value-evidence-ledger`). Paste the per-domain grade, the backing finding ids and operations, and the gap list (domains not `autonomous`).
- [x] Mutation control: let teaching evidence count toward `autonomous` and show case (a) goes red. Paste, then revert.

## Evidence

### AC1 — `node --test plugin/test/discovery-portfolio.test.mjs` exits 0, with the four new coverage cases

```
$ node --test plugin/test/discovery-portfolio.test.mjs ; echo "exit=$?"
✔ (a) fix_landed_commit is READ FROM GIT, never taken from the caller
✔ (b) a caller-supplied landing that DISAGREES with git is refused; an agreeing one is accepted
✔ (c) a duplicate (same component set AND claim) gets duplicate_of and leaves net_new_value
✔ (d) a `noise` rating reduces net_new_value, and is not the same value as `unrated`
✔ (e) missing usage ⇒ cost:null and an unmeasured count; recorded usage × gateway rates ⇒ USD
✔ (f) a worker's rateFinding is refused; only an operator session may rate
✔ (g) adding 10 refuted records leaves net_new_value unchanged (the anti-inflation control)
✔ an origin_ref that resolves in no carrier is refused; a resolvable one names its carrier
✔ a re-ingest of the same finding_id is a no-op, not a second record (the carrier is append-only)
✔ recurred is read from later evidence-store outcomes; an unknown component set ⇒ null, not false
✔ the frozen backfill table is well-formed and every row's origin_ref is a resolvable SHAPE
✔ (a) coverage: a TEACHING-level finding yields `assisted`, never `autonomous`
✔ (b) coverage: a retired or contaminated method adds nothing; a live one does
✔ (c) coverage: an unclassified finding is reported `unclassified`, never guessed into a domain
✔ (d) coverage: one autonomous production-open supported finding with a landed fix yields `autonomous`
✔ coverage: `evaluated:false` when the method half cannot be read, and every domain still names its own causes
✔ a domain assignment is an append-only overlay: it fills a finding that states none, and refuses one that states its own
ℹ tests 17
ℹ pass 17
ℹ fail 0
exit=0
```

Case (a) is the HARDEST shape for the clause, which is why it is the one AC3 mutates: an **autonomous** origin (routine), `outcome:"supported"`, and a fix whose landing git confirms — everything the `autonomous` grade wants except the evidence level. Only `teaching` stands between it and an autonomous grade:

```
assert.equal(row.grade, "assisted", "the answer was known before any tool ran — that is transcription, not discovery");
assert.deepEqual(row.findings.autonomous_ids, []);
assert.deepEqual(row.findings.not_autonomous, [{ finding_id: "C-TEACHING", reason: "EVIDENCE_LEVEL_NOT_AUTONOMOUS:teaching" }]);
assert.deepEqual(map.gap, DOMAINS, "nothing in this fixture is autonomously covered");
```

`transfer` is refused by the same clause and is asserted as a pure arm (`autonomousEvidenceFor`) against all three levels, so the refusal is a rule and not a `teaching`-only patch. This matches point 4 of the 2026-10-12 strategy as landed by `gap-discovery-evidence-level-teaching-vs-independent`: teaching/transfer are "excluded from every independent metric", which is exactly the `AUTONOMOUS_EVIDENCE_LEVELS = ["independent","production-open"]` gate.

Case (b) holds the finding half at ZERO (`row.findings.total === 0`) so the grade can only come from a method, with a three-arm fixture that proves the two refusals are checks rather than a blanket refusal — a `draft` method contributes, a `retired` one and a `contaminated` one do not:

```
assert.deepEqual(row.methods.claiming.map((m) => [m.method_id, m.status, m.contaminated, m.contributes]), [
  ["m-active-contaminated", "active", true, false],
  ["m-draft", "draft", false, true],
  ["m-retired", "retired", false, false],
]);
assert.equal(row.grade, "assisted", "the draft method is the only contributor");
```

Case (c) asserts BOTH causes of unreadability as separate values: a finding that states no domain at all (`carried_domain: []`) and a carrier line carrying a domain outside the vocabulary (`carried_domain: [{finding_id:"C-BOGUS", domain:"no-such-domain"}]`). Only a hand-edited carrier can produce the second, because ingest refuses the value — `DOMAIN_NOT_IN_VOCAB:not-a-domain` and `DOMAIN_REASON_REQUIRED` are asserted, and a refused domain writes nothing.

Case (d) asserts the `autonomous` grade plus the named operation that produced it, and the refutation arm:

```
assert.equal(row.grade, "autonomous");
assert.equal(row.grade_reason, "C-AUTO(landed-fix)");
assert.deepEqual(row.operations, [{ finding_id: "C-AUTO", operation: "routine-probe", origin: "autonomous-routine",
  origin_ref: "run-fixture-1", origin_carrier: ".quay/routine-findings.jsonl" }]);
assert.equal(ref.grade_reason, "C-REFUTED(refutation)");
assert.deepEqual(valueMetrics(readPortfolio(root).records).zero_or_negative.refuted, ["C-REFUTED"], "capability, not value");
```

Two further cases pin the two "could not look" states as their own values rather than as a passing or empty answer (硬规则 3b): an unreadable method registry is `ok:true` with `evaluated:false` / `methods.evaluated:false` and every row carrying `METHOD_HALF_NOT_EVALUATED` — never "no method claims this domain" — while an unresolvable shared checkout refuses the whole map (`ok:false`, `domains: []`) instead of reporting every domain `none`. The same suite pins the assignment overlay: it fills a finding that states none (`domain_source:"assignment"`), is idempotent by `finding_id`, and REFUSES a finding that states its own domain (`DOMAIN_ALREADY_STATED`) so no shadowed line can sit permanently in an append-only carrier.

### AC2 — the real map, from the production portfolio

Read through the module's own shared-checkout resolution; the 13 real rows live in `/data/home/yale/work/quay/.quay/discovery-portfolio.jsonl`. The re-run is idempotent and adds **zero** lines — the domain lines were written on the first run and every later run is a `DUPLICATE_ID` no-op:

```
carrier (shared checkout) = /data/home/yale/work/quay/.quay/discovery-portfolio.jsonl
carrier lines before = 26        (13 portfolio_finding + 13 portfolio_domain)
backfill: ingested=[] already_present=13 domains_assigned=0 refused=[]
carrier lines after  = 26
valueMetrics net_new_value BEFORE=11 {"autonomous-routine":3,"autonomous-experiment":3,"operator":4,"mechanical-instrument":1}
valueMetrics net_new_value AFTER =11 {"autonomous-routine":3,"autonomous-experiment":3,"operator":4,"mechanical-instrument":1}   <- unchanged: a domain is not value
```

| domain | grade | findings | autonomous | operations that produced them |
|---|---|---|---|---|
| shared semantics | **autonomous** | F02,F03,F04,F06,F08,F10,F12 | **F02,F03,F04,F06** | F02 `routine-probe`(semantic-dedup-scan-1791733865369#isDirectInvocation-pair); F03 `routine-probe`(…#splitArgs-isNonNegInt-trio); F04 `verifier-call`(E-DT-1-Hp cluster 11); F06 `verifier-call`(E-HYPGEN-ACCEPT-1 cluster 5); F08 `operator-work`(gap-errorsignature-merges-different-exit-codes); F10 `instrument`(enum-surface-parity-check.ts); F12 `user-report`(EXP-99aa24ac34d53b6a) |
| config→behavior | assisted | F07,F11 | — | F07 `operator-work`(gap-routine-quota-window-ms-parsed-but-inert); F11 `operator-work`(gap-in-round-suite-rerun-never-executed-in-production) |
| writer/checker contract | **autonomous** | F01,F05 | **F01,F05** | F01 `routine-probe`(…#doc-check-cache-vs-scoped-gate-cache); F05 `verifier-call`(E-HYPGEN-AB-1-B cluster 8) |
| state transitions | assisted | F09 | — | F09 `operator-work`(EXP-99aa24ac34d53b6a) |
| reuse refutation | **autonomous** | N01 | **N01** | N01 `verifier-call`(E-HYPGEN-ACCEPT-1 cluster 7) |
| method trustworthiness | none | — | — | — |

Per-domain backing, verbatim from `grade_reason`:

```
shared-semantics        autonomous  F02(landed-fix),F03(landed-fix),F04(landed-fix),F06(landed-fix)
config-to-behavior      assisted    NO_AUTONOMOUS_FINDING:F07=ORIGIN_NOT_AUTONOMOUS:operator;F11=ORIGIN_NOT_AUTONOMOUS:operator
writer-checker-contract autonomous  F01(landed-fix),F05(landed-fix)
state-transitions       assisted    NO_AUTONOMOUS_FINDING:F09=ORIGIN_NOT_AUTONOMOUS:operator
reuse-refutation        autonomous  N01(refutation)
method-trustworthiness  none        NO_NEW_FINDING_CLASSED_TO_THIS_DOMAIN

GAP (named domains not autonomous): ["config-to-behavior","state-transitions","method-trustworthiness"]
unclassified: {"grade":"unclassified","total":0,"by_origin":{},"by_evidence_level":{},"ids":[],"carried_domain":[]}
methods: {"evaluated":true,"reason":null,"evaluated_count":5,"contaminated_verdicts_evaluated":17,"ledger":".quay/discovery-contaminated-verdicts.jsonl"}
context: {"findings":13,"classified":13,"assignments":13}
domain_source of the 13 (record|assignment): ["assignment"]
```

The map reproduces the operator baseline's own ✓/✗ marks exactly — shared semantics ✓ (F02,F03,F04,F06 — the baseline's list, not the whole 7-finding row), writer/checker ✓ (F01,F05), reuse refutation ✓ (N01), and config→behavior / state transitions / method trustworthiness in the gap.

**The gaps, named:** `config→behavior` is covered only by F07 (a parsed-but-unconsumed config key) and F11 (a rerun command never declared) — both `operator`, both `teaching`/`production-open` but not autonomous origin, so the map refuses the grade and says which clause refused it. `state transitions` has exactly one finding, F09, and it too is `operator`. `method trustworthiness` has NO portfolio row at all — the operator audits (lineage leak, temporal binding, tool-as-subject, cross-experiment holdout reuse) exist as TASK BODIES, not as findings, so the map reports `none` and, per Plan 2, refuses to invent a row for them. That is a divergence worth stating plainly rather than smoothing over: the baseline's phrasing "method trustworthiness = operator audits only" implies operator evidence exists, and the ledger says it has never been recorded in the portfolio. The map's job is to report that, not to paper over it. (`assisted` is what it would read once those audits are ingested as findings; the four operator audit tasks are not in this task's Touches and adding rows would also move the dependency's pinned `net_new_value = 11`, so nothing was ingested.)

The method column is empty for every domain, and that is measured rather than assumed: 5 methods are current (1 `draft`, 4 `retired`) and 17 verdicts are on the contaminated-verdict ledger, and the claim rule is a literal NAME match over `applicability` prose — no method's prose names any of the six domains. A keyword heuristic over that prose would have invented claims the methods never made, which is the same defect as guessing a finding's domain from its claim.

### AC3 — mutation control: let teaching count toward `autonomous` ⇒ case (a) goes red

The mutation is one constant — `teaching` and `transfer` added to the allowed evidence levels, i.e. the anti-inflation clause removed:

```
-export const AUTONOMOUS_EVIDENCE_LEVELS = Object.freeze(["independent", "production-open"]);
+export const AUTONOMOUS_EVIDENCE_LEVELS = Object.freeze(["teaching", "transfer", "independent", "production-open"]);
```

```
$ node --test plugin/test/discovery-portfolio.test.mjs      # under the mutation
✖ (a) coverage: a TEACHING-level finding yields `assisted`, never `autonomous` (45.301296ms)
  AssertionError [ERR_ASSERTION]: the answer was known before any tool ran — that is transcription, not discovery
      at TestContext.<anonymous> (.../plugin/test/discovery-portfolio.test.mjs:490:10)
  actual: 'autonomous',
  expected: 'assisted',
ℹ tests 17
ℹ pass 16
ℹ fail 1
```

Exactly one case goes red, and it is (a) — the assertion is on the ABSOLUTE grade, not on a delta, which is what makes the control non-vacuous: the same fixture grades `autonomous` once the clause is gone and `assisted` once it is back. Cases (b)/(c)/(d) stay green under the mutation, so the red is attributable to the clause and not to a fixture that could never pass.

Reverted; the module is byte-identical to its pre-mutation state:

```
$ md5sum docs/analysis/discovery-portfolio.mjs
before mutation : fab5d851679118d112664e085e87b76f
after  revert   : fab5d851679118d112664e085e87b76f
$ node --test plugin/test/discovery-portfolio.test.mjs
ℹ tests 17   ℹ pass 17   ℹ fail 0
```

### Design notes — two judged extensions, stated rather than smuggled

1. **The `autonomous` grade has a second arm.** Plan 1 spells it as "≥1 supported autonomous `independent`/`production-open` finding with a landed fix". Taken literally that leaves `reuse refutation` structurally uncoverable — the domain's point is refuting a reuse claim, and you do not file a fix when the claim was wrong — yet the Proposal's own baseline credits it (`reuse refutation (N01)`). The grade therefore accepts a correct autonomous refutation as a SECOND arm, and the two arms are reported apart (`via: "landed-fix"` / `via: "refutation"`) so no row can be read as more than it is. The split is principled and already established in this module family: **coverage is capability, value is `valueMetrics`** — the same N01 sits in `zero_or_negative.refuted` as ZERO value (`gap-discovery-portfolio-value-evidence-ledger`: "an honest negative, kept in the record as zero value"), and it is the only thing that makes reuse refutation's autonomy visible. Landed fixes remain the only evidence of VALUE; refutations are evidence of capability and of nothing else.
2. **A `noise` rating does NOT withhold coverage; a duplicate does.** These are the two axes again: "worthless" is a human's VALUE judgment about a finding that is real, so it subtracts in `valueMetrics` and not here (asserted both ways in case (d): the grade stays `autonomous` while `net_new_value` drops by one); a duplicate is not a new finding at all, so it contributes nothing to any domain and is listed under `findings.duplicates`. An unrecognised method `status` contributes nothing (`STATUS_NOT_IN_VOCAB`) — the half that must fail closed.
3. **The 13 production rows carry their domain via an append-only overlay, not a rewritten record.** They were ingested on 2026-10-12 before `domain` existed, and the carrier is append-only with an id keyed on `finding_id`, so a re-ingest to add the field is a `DUPLICATE_ID` no-op by construction — the only alternatives were deleting and regenerating the production carrier or guessing the domain at read time. Their domains therefore arrive as their own `portfolio_domain` lines (the model the RATINGS already use), appended once by a `backfill` re-run; `readPortfolio` reports which arm supplied each value (`domain_source`: `record` vs `assignment`) so "stated at ingest" and "added later" stay different values. The domain VALUES are transcribed from the operator baseline's `dimension` column with a per-row reason — the operator made those judgments and they are the only source for them, which is precisely what Plan 2's "never guessed" requires. The overlay is additive: `net_new_value` and its per-origin split are unchanged by it (11 → 11 above).

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-coverage-map-from-findings` green.

## Touches
- tasks/gap-discovery-coverage-map-from-findings.md
- docs/analysis/discovery-portfolio.mjs
- plugin/test/discovery-portfolio.test.mjs
