---
id: gap-open-semantic-discovery-routine-track
title: "P0: periodic open-ended semantic architecture discovery on the routine
  track (hypothesis gen + Read/Grep verify + independent refutation,
  report-only, hard-budgeted)"
status: done
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
- [x] Unit tests (stub models) exit 0, covering:
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

  **Evidence.** `node --experimental-strip-types --test plugin/test/open-semantic-discovery-routine.test.mjs` ⇒ **38 tests, 38 pass, 0 fail** (exit 0). The 38 cases cover (a)×3, (b)×2, (c), (d)×3, (e)+2 supporting, (f), (g)×3, (h)×2, (i)×2 (fixture + source), (j)×2, (k)×4, (l), the pin, engine resolution, the RoutineSpec/`qualityGateRoutines` wiring, `usdBudgetUsage`, `focusFromText`/`priorFocuses`, `focusDirective`, and one **INTEGRATION** case that runs the REAL `runInvestigator` (pinned cwd policy) + REAL `clusterHypotheses` + REAL `runVerifier` (frozen prompt, `{{HYP}}` substitution, stream parsing) with only the subprocess SPAWN stubbed. Case (f)'s tool-less arm is asserted on the argv builder itself: `stepArgv(...{tools:""})` ⇒ `--max-turns 1`; and every argv in a real round is asserted to carry a positive `--max-turns`.

- [x] Negative control: in a scratch copy, remove the refutation step ⇒ (g) goes red. Paste the output.
  ```
  $ node --test --test-name-pattern="NEGATIVE CONTROL" plugin/test/open-semantic-discovery-routine.test.mjs
      NEGATIVE CONTROL (g): mutant reports confirmed=true for a supported+refuted cluster (claim was «NOT confirmed»)
  ✔ NEGATIVE CONTROL (g) — remove the refutation step in a scratch copy ⇒ the (g) claim goes RED (52.9ms)
  ✔ NEGATIVE CONTROL (k) — gate the round on «arch-discovery reported new fingerprints» ⇒ the (k) claim goes RED (27.4ms)
  ℹ tests 2 / pass 2 / fail 0
  ```
  The scratch copy is built by `scratchModule(mutate)`: a temp tree whose `plugin/scripts/*` and `docs/analysis` are SYMLINKED to this worktree (so the module's relative imports still resolve) plus a symlinked `node_modules` (so its bare `yaml` specifier resolves), with only the module under test written as a mutated REAL file. The (g) mutation replaces `const confirmed = row.verdict === "supported" && refutation?.verdict === "supported";` with `const confirmed = row.verdict === "supported";` AND disables the refutation branch (`if (false) {`). Run against the SAME fixture that makes (g) green on the real module (verifier `supported`, refuter `refuted`), the mutant records `refutation_verdict: "not-run"` and `confirmed: true` — i.e. the (g) claim is FALSIFIED. The control is live.

- [x] Static control: the module has no static import of `docs/analysis/`, and the shipped-bundle checks stay green. Paste both.
  ```
  $ grep -nE '^\s*(import|export)[^;]*from\s*"[^"]*docs/analysis' plugin/scripts/open-semantic-discovery-routine.ts
  (no output — 0 matches)
  $ grep -n 'await import(/\* @vite-ignore \*/ pathToFileURL(' plugin/scripts/open-semantic-discovery-routine.ts
  581:      const mod = (await import(/* @vite-ignore */ pathToFileURL(r.path).href)) as unknown;

  $ node --experimental-strip-types --test packages/quay/test/build-plugin-dist.test.mjs \
      plugin/test/shipped-set.test.mjs plugin/test/shipped-shell-reachability.test.mjs \
      plugin/test/capability-catalog.test.mjs plugin/test/carrier-registry-completeness.test.mjs
  ℹ tests 85 / pass 85 / fail 0   (exit 0)
  ```
  The same claim is a live test case inside the routine's own file (`case (i) — the engine is resolved at runtime … with mutation control`): the predicate is applied to the real source AND to a mutated copy that turns it red, so the zero is a real zero.

- [x] Driver assembly line after the self-reload shows the routine and its settings. Paste the anchor.log line.
  ```
  $ node --experimental-strip-types -e '<openSemanticDiscoveryRoutineFromConfig(REAL WORKSPACE ROOT) + quality-gate-driver.ts formatOpenSemanticDiscoveryAssembly>'
  quality-gate-driver: open-semantic-discovery 例程已装配（enabled, interval=60m, interval_until=2026-10-20T12:00:00.000Z, max_model_calls_per_24h=120 (HARD: pre-spawn reservation per subprocess, trailing-24h; a reservation with no outcome still counts as spent), max_usd_per_24h=$30 (HARD: realized gateway cost from the same ledger; an unknown price counts as the per-call ceiling, never 0), investigator_runs=1, max_clusters_verified=3, verifier_max_turns=8, refutation_max_turns=6, report-only: 不立案、不写 tasks/ 或 goals/）
  ```
  This is the EXACT string `main()` prints for this routine, computed from the REAL `/data/home/yale/work/quay/.quay/config.yml` through the REAL `openSemanticDiscoveryRoutineFromConfig` and the REAL `formatOpenSemanticDiscoveryAssembly`. ⛔ The `anchor.log` occurrence itself is **未读到（待外部）**: it requires (i) this delta to land on `develop`, (ii) the develop→main-checkout sync so the deployed `quality-gate-driver.ts` changes on disk, and (iii) the anchor's self-refresh (`watchedSourceFiles` names only the kind's driver file + the shared kernel files, so the routine MODULE alone would land inert — which is why this file is touched at all). The next due moment is the first quality-driver round after that self-reload.

- [x] Negative control: in a scratch copy, gate the round on "arch-discovery reported new fingerprints" ⇒ (k) goes red. Paste the output.
  ```
  NEGATIVE CONTROL (k): mutant spawned 0 calls when arch-discovery reported 0 new fingerprints (claim was «the round still runs»)
  ✔ NEGATIVE CONTROL (k) — gate the round on «arch-discovery reported new fingerprints» ⇒ the (k) claim goes RED (27.4ms)
  ```
  The mutation inserts, immediately before the engine-module load, a gate that reads `.quay/arch-discovery-findings.jsonl` and returns `not-evaluated` when the newest `scan-round` line carries `new: 0`. Against the (k) fixture (that carrier present with `new: 0`), the mutant spawns **0** calls — i.e. the (k) claim ("the round still runs") is FALSIFIED. The real module's own (k) case asserts the opposite on the same fixture, and additionally that the module never spells that carrier's filename as a string literal.

- [x] Production reading: the first `invoked_by:"resident-driver"` round after landing, with ≥1 investigator call and ≥1 verifier call — paste the scan-round line, the investigator's stated focus and the files it actually read (from the stream's tool calls), the per-cluster records (claim, verifier verdict, refuter verdict, value assessment, turns, cost), and the ledger reservations. （待外部）
  **未读到（待外部）.** The routine is declared in the workspace config and assembled by the driver's routine table, but no round has been written by the RESIDENT quality-gate driver yet: the carrier `.quay/open-semantic-discovery-findings.jsonl` does not exist in the main checkout (measured at task close), and the deployed `quality-gate-driver.ts` does not yet carry this routine (it lands with this delta). Next due moment: the first quality-driver round after the anchor self-refresh picks up the landed driver — cadence 60m, no last-run entry, so the first round is due IMMEDIATELY on reload. ⛔ Nothing here manufactures that line: the round requires the resident driver to run the new assembly.

- [x] Honest outcome: from that production round, name every `confirmed` cluster (claim + components) or state 0 confirmed; never re-run to chase a non-zero result. （待外部）
  **未评估（待外部）** — and deliberately NOT stated as "0 confirmed": no production round has been read, so the population is unmeasured rather than measured-empty (硬规则 3b: "not read" and "read as zero" must not be shaped alike). When the production round exists, the carrier's own `confirmed.count` + the `kind:"cluster"` records carry the answer (`claim`, `components`, `verifier_verdict`, `refutation_verdict`, `model_value_assessment`), and the round line's `confirmed.claims` lists them. ⛔ No re-run will be made to chase a non-zero result.

## Definition of Done
- All AC ticked with output pasted; production AC may remain （待外部） with the next due time stated.
- `scripts/test.sh --for-task gap-open-semantic-discovery-routine-track` green.
  **Evidence (final reading, after `## Touches` gained `plugin/scripts/discovery-method-routine.ts`):** `bash scripts/test.sh --for-task gap-open-semantic-discovery-routine-track --allow-thin` ⇒ **exit 0, 168 tests / 168 pass / 0 fail**, scoped static checks included. (The same command before that Touch was added read 119/119 — the count moved with the selection, not with the code.) The scoped-gate cache was written against the develop sha in effect at that run.
- No change to other routines' cadence or budgets.
  **Evidence:** `diff /tmp/osd-config-before.yml /data/home/yale/work/quay/.quay/config.yml` ⇒ **pure addition**: the only non-comment lines are the new `open_semantic_discovery:` key and its ten values. Zero lines removed or modified — `discovery_method` (60m / `interval_until` 2026-10-19T14:00Z / 240 calls per 24h / 6 per round), `arch_discovery` (360m), the four `loop.routines:` probes and `semantic-dedup-scan` (1440m) / `freshness-refresh` (120m) are byte-identical. No code path this delta touches reads or writes another routine's cadence or ledger: the routine has its OWN ledger (`.quay/open-semantic-discovery-model-budget.jsonl`) and its OWN cap.
  ⚠️ NOTE for the reviewer: the `open_semantic_discovery:` section was written into the MAIN CHECKOUT's `.quay/config.yml`, because that file is gitignored workspace state — a worktree copy is refreshed FROM it, so a declaration placed only in a worktree would be overwritten and would never be the declaration production reads. The section is INERT until the deployed `quality-gate-driver.ts` carries this routine, and the only pre-existing edits to that file are the ten added lines above.
- No mechanical finding logic (classifier, fingerprint gate, pattern table) added; any mechanical piece is listed in the evidence with its role (scheduling / persistence / dedup-assist / isolation / budget / tool wrapper).
  **Evidence — every mechanical piece in `plugin/scripts/open-semantic-discovery-routine.ts`, with its role:**
  1. `runOpenSemanticDiscovery`'s gates (config → halt → carrier-readable → due → the two ceilings) — **scheduling**. None of them inspects a hypothesis, a component or a claim.
  2. `readOpenSemanticDiscoveryConfig` / `parseOpenSemanticDiscoverySection` — **scheduling** (the declaration surface).
  3. `readCarrierRounds` / `appendCarrierRecords` / `readLedgerRecords` / `appendLedgerRecords` / `writeLastRunStamped` (imported from `discovery-method-routine.ts`) — **persistence**. Append-only; a torn line THROWS rather than reading as "nothing".
  4. `priorFocuses` / `focusFromText` — **state persistence** (the model's own stated focus is carried to the next round). `FOCUS_MARKER` is a PROTOCOL tag, not a problem-class pattern: it selects and rejects nothing.
  5. `clusterHypotheses` (imported from the engine) — **dedup ASSISTANCE ONLY**, merging near-duplicate hypotheses by component-set overlap. Nothing is discarded by shape; `beyond_cap` is a COUNT, not a judgment.
  6. `materializeStrippedPin` + the `PIN_FORBIDDEN_DIRS` strip + `verifyCwdRefusal` — **safety isolation** (the model may not read the project's notes about itself; the strip is CHECKED, not asserted).
  7. `openModelBudget` / `usdBudgetUsage` / `reservingStep`'s reserve→spawn→outcome→cost ordering — **budget** (hard, atomic, pre-spawn; unknown price ⇒ the per-call ceiling, never 0).
  8. `stepArgv` + `spawnModelCall` — **tool wrapper** (the explicit `--max-turns` on every argv, and the `cwd` at the pin that the shared `runAsync` cannot express).
  9. `developTip` — **scheduling** (which revision is pinned).
  ⛔ There is no classifier, no fingerprint gate, no pattern table, and — asserted by case (l) — no regular expression of any kind in this module.
  **One edit to a sibling module, named because it is outside the new file:** `ReservationMeta.step` in `plugin/scripts/discovery-method-routine.ts` widens from `"reflection" | "verification"` to `string`. Role: **budget** — the ledger is SHARED, and a union owned by one routine cannot name another's steps without the record lying about what it guards. Nothing switches on the value; every existing call site passes a literal and is unaffected.

## Touches
- tasks/gap-open-semantic-discovery-routine-track.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- docs/analysis/arch-hypothesis-generation.mjs
- .quay/config.yml
