---
id: gap-open-semantic-discovery-routine-track
title: "P0: periodic open-ended semantic architecture discovery on the routine
  track (hypothesis gen + Read/Grep verify + independent refutation,
  report-only, hard-budgeted)"
status: ready
labels:
  - gap
  - discovery-method
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-24h-budget-hard-reservation
---
## Proposal
**Governing principle — SEMANTIC FIRST, MECHANIZE LATER** (user ruling, 2026-10-12): the first phase builds an end-to-end SEMANTIC loop. The model reads source and context, explores openly, builds and refutes hypotheses, verifies independently, assesses engineering value, and reflects on successes and failures into Discovery Methods / meta-methods that steer the next round.
- Mechanical code is limited to scheduling, state/provenance persistence, dedup *assistance*, safety isolation, budget and tool wrapping. It never replaces a semantic judgment, never gates whether the model may look, and "no mechanical change" never suppresses a semantic round.
- Hard-coded rules, classifiers, fingerprints or pattern tables for *finding* problems are out of scope. Crystallizing a step into code comes later, only for high-repetition, low-ambiguity, stable steps after the loop has shown real findings, reviewable reasoning, method reuse and measured gain — and always keeps a semantic fallback, a baseline comparison and degradation monitoring.
- **Building the automation is not success. A semantic round that ran on real source and produced reviewable reasoning is.**

Measured 2026-10-12 (operator read-only audit of `.quay/quality-round.jsonl`, `routine-findings.jsonl`, `arch-discovery-findings.jsonl`, `meta-driver-round.jsonl`): continuous automatic architecture discovery produced **zero confirmed new code problems in 24h**. The routines and their limits:
- `arch-discovery` is purely mechanical, with no model and no verification. Its 2 "new" fingerprints on 13:58Z were test-red signals.
- `semantic-dedup-scan` is model-driven, but only every 1440m and only for the duplication class. Its last batch, 10-11 15:51Z, gave F01–F03.
- `discovery-method` reflects on Experience summaries with `tools:""`. It produces methods, not findings, and nothing applies them to code.
- `meta-driver` / `architecture-review` idle without upstream input.

The only path that found a real new defect recently was **open-ended hypothesis generation + source Read/Grep verification** (`docs/analysis/arch-hypothesis-generation.mjs` `investigate`/`verify`; the 2026-10-12 capability-gain experiment found `GAIN1-CTRL-c10`, fixed by `gap-self-report-vocab-audit-check-pattern-tables-diverge`, `74b4341b8`). That path is run only by hand, never scheduled.

This task wires that path into the EXISTING quality-driver routine track as a bounded, report-only, periodically scheduled routine. It is not a new driver kind, not a Meta-Meta driver, and not a task/Goal filer.

## Plan
1. **New routine module** `plugin/scripts/open-semantic-discovery-routine.ts`, modelled on `discovery-method-routine.ts`, and registered in the quality driver's routine table like `discovery-method`/`arch-discovery`.
   - It is a SHIPPED file, so load `docs/analysis/arch-hypothesis-generation.mjs` from disk at run time (as `loadDiscoveryModules` does), never by a static `../../docs/analysis` import.
   - Declare the new script in `plugin/scripts/capability-catalog-declarations.json`.
   - Declare its carrier (`.quay/open-semantic-discovery-findings.jsonl`) in `docs/carrier-registry.json`.
2. **One round** (all steps reuse `arch-hypothesis-generation.mjs` functions, no re-implementation):
   - (a) pin the current develop tip into a stripped tree (`PIN_FORBIDDEN_DIRS` enforced) and build the inventory over a declared scope;
   - (b) **Semantic exploration on real source.** The investigator runs with `--tools Read,Grep,Glob` rooted at the pinned tree and an explicit `--max-turns`, so the model reads code and context itself. It does not reason only over a mechanically pre-digested inventory, which is what `runInvestigator` does today (`--tools ""` plus an empty cwd, built for blind experiments; `arch-hypothesis-generation.mjs:36`).
     - The inventory may be passed as an optional map. It is never a filter or a prerequisite: no "mechanical candidate first".
     - The model chooses its exploration focus and states it.
     - A persisted list of previously explored focuses (mechanical state) is passed back so later rounds can choose to go elsewhere. The choice stays the model's.
     - The blind tool-less mode stays available for controlled experiments (the P2 task), not as the production default.
     - Hypotheses go through `clusterHypotheses` only to merge near-duplicates, never to discard by pattern;
   - (c) `runVerifier` on at most K clusters with `--tools Read,Grep` on the pin and an explicit `--max-turns`;
   - (d) an **independent refutation pass**: each `supported` cluster gets a separate fresh-context call whose only job is to refute it from the code (no access to the first verifier's reasoning beyond the claim and components); a cluster is reported `confirmed` only if it survives;
   - (d2) **semantic value assessment**: each confirmed cluster gets a bounded call that states the engineering impact, the evidence and a candidate fix outline. It is recorded as `model_value_assessment` and is never a human rating;
   - (e) append one `scan-round` line plus per-cluster records (claim, components, verifier verdict, refutation verdict, evidence lines, model identity, per-call turns, tokens, gateway cost) to the carrier.
   - No task, Goal, Portfolio or Experience write in this task; that is the follow-on.
3. **Config section** `loop.open_semantic_discovery` in `.quay/config.yml`. All keys required, fail-closed on any malformed key:
   - `enabled`, `interval: interval:60m` plus `interval_until` (temporary, same rule as discovery-method);
   - `investigator_runs`, `max_clusters_verified`, `verifier_max_turns`, `refutation_max_turns`, `max_wall_ms`;
   - `max_model_calls_per_24h`, `max_usd_per_24h`.
   - Proposed first values: 1 run, 3 clusters, 8 turns, 6 turns, 1200000 ms, 120 calls/24h, $30/24h.
   - Basis: GAIN1 measured about $0.05 per investigator run and about $0.5 per verifier cluster at gateway rates, so a round costs about $2–3; state the measured value in the evidence.
4. **Budget.** Every subprocess (investigator, verifier, refuter) reserves one unit BEFORE it spawns, through the hard reservation ledger delivered by `gap-discovery-method-24h-budget-hard-reservation`, under this routine's own key and cap. 240 is discovery-method's cap and is not shared silently.
   - The USD cap is checked from the ledger's realized gateway cost (`loadGatewayRates` + `deriveCost` in `discovery-portfolio.mjs`); unknown cost counts as the per-call ceiling estimate, never 0.
   - Every CLI subprocess runs with an explicit `--max-turns`; no unbounded subprocess.
   - Manual and resident runs share the ledger; manual runs never advance production last-run (same `invoked_by` split as discovery-method).
5. **Kill switch / halt / report-only.** `enabled:false` or halt ⇒ zero spawns. Budget refusal ⇒ `not-evaluated:budget-24h` / `budget-usd-24h`. A failure records `failed` with its reason, never shaped like idle.
6. **Deployment.** The delta touches `plugin/scripts/quality-gate-driver.ts`, so the anchor self-refresh reloads it; its assembly line prints the routine's settings.

## Acceptance Criteria
- [ ] Unit tests (stub models) exit 0, covering:
  - (a) disabled / halted ⇒ zero spawns;
  - (b) malformed or missing key ⇒ `failed`, zero spawns;
  - (c) sub-360m interval without `interval_until` or without either 24h cap ⇒ config error;
  - (d) reservation before each of investigator, verifier and refuter, with a call refused at the cap ⇒ stop and report;
  - (e) USD cap reached ⇒ `not-evaluated:budget-usd-24h`;
  - (f) every spawned argv carries `--max-turns` (investigator `--tools ""` ⇒ 1);
  - (g) a cluster that the verifier supports and the refuter refutes ⇒ NOT `confirmed`;
  - (h) manual `--once` does not advance last-run;
  - (i) no write to `tasks/`, Goals, Portfolio or Experience — enforced by a static control on the module's imports;
  - (j) the investigator argv carries `Read,Grep,Glob` rooted at the pin plus `--max-turns`, and its cwd is the pin;
  - (k) a round runs when the pin is unchanged since the last round, when arch-discovery reports 0 new fingerprints, and when the inventory is empty or missing. None of these suppresses the semantic round;
  - (l) the module contains no table of problem-class patterns or regexes used to select or reject hypotheses (static control naming what it scans for). Dedup assistance on identical component sets is allowed and named.
- [ ] Negative control: in a scratch copy, remove the refutation step ⇒ (g) goes red. Paste the output.
- [ ] Static control: the module has no static import of `docs/analysis/`, and the shipped-bundle checks stay green. Paste both.
- [ ] Driver assembly line after the self-reload shows the routine and its settings. Paste the anchor.log line.
- [ ] Negative control: in a scratch copy, gate the round on "arch-discovery reported new fingerprints" ⇒ (k) goes red. Paste the output.
- [ ] Production reading: the first `invoked_by:"resident-driver"` round after landing, with ≥1 investigator call and ≥1 verifier call — paste the scan-round line, the investigator's stated focus and the files it actually read (from the stream's tool calls), the per-cluster records (claim, verifier verdict, refuter verdict, value assessment, turns, cost), and the ledger reservations. （待外部）
- [ ] Honest outcome: from that production round, name every `confirmed` cluster (claim + components) or state 0 confirmed; never re-run to chase a non-zero result. （待外部）

## Definition of Done
- All AC ticked with output pasted; production AC may remain （待外部） with the next due time stated.
- `scripts/test.sh --for-task gap-open-semantic-discovery-routine-track` green.
- No change to other routines' cadence or budgets.
- No mechanical finding logic (classifier, fingerprint gate, pattern table) added; any mechanical piece is listed in the evidence with its role (scheduling / persistence / dedup-assist / isolation / budget / tool wrapper).

## Touches
- tasks/gap-open-semantic-discovery-routine-track.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- docs/analysis/arch-hypothesis-generation.mjs
- .quay/config.yml
