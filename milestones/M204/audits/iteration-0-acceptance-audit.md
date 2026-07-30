# M204 / DIR-126-E — iteration-0 acceptance audit (adversarial, fresh context)

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Task:** DIR-126-E — recalibrate the prepare-milestone capacity model from real telemetry
(`--capacity-report` aggregation); fifth and final child of DIR-126's 5-way split.
**Charter:** experiments/quay-perpetual-stream/charters/M204-dir126e-capacity-report.md
**Land commit under audit:** `23f8891` (on `master`).
**Verdict:** **CONCERNS** — all 23 AC items CONFIRMED against auditor-generated evidence (never the
implementer's self-report); two disclosed concerns, neither a refutation; mechanical gate exits 0.

## Method

Fresh-context, refute-first: the auditor re-ran every load-bearing command itself (live CLI
invocations on both mirrors, byte-reproducibility `cmp`s, `sync-vendor.sh --check`, the module
test file, the mechanical gate), read the implementation and fixture source directly, and
re-derived the regenerated doc's figures from an independent live run. Where the environment's
`grep` silently swallowed output (verified anomaly — `grep -c` on a known-present pattern exited
1 with no output), verification fell back to direct `Read` and `node`-based source scans.

## AC verification (23/23 CONFIRMED)

| # | AC (short) | Verdict | Auditor-generated evidence |
|---|---|---|---|
| 1 | **Gate item — real production wiring** | CONFIRMED | Auditor's OWN subprocess runs: canonical `node experiments/.../milestone-preparation-check.ts --capacity-report --workspace .` → exit 0, well-formed JSON, `code: ok`, `sampleCount: 29`; plugin mirror same invocation → exit 0, `code: ok`; stdout byte-identical across mirrors. Dispatch is a real independent top-level `if (parsed.capacityReport)` block at `milestone-preparation-check.ts:1092`, same shape as `--build`/`--metrics`/`--telemetry-report` — not `--selftest`-only. |
| 2 | Capacity report reproducible + doc regenerated | CONFIRMED | Live report carries every listed field: `sampleCount`, two UNPOOLED nearest-rank distributions (`receiptPrepareMs` P50 20.9m/P85 219.3m n=3; `telemetryProxyMs` P50 29.1m/P85 58.8m n=26), `byStratum` class/highRisk/terminal/decision with contentAgent summaries, `agentWork` measured/measuredZero/notMeasured/wallTimeProxyMinutes, `preparedOverAttempt` 0.077, `byDecisionKind`/`byTerminalReason` yield, `absorbedTaskPerPrepareHour` 9/4.004h ≈ 2.248, `waste.concurrentDuplicate` 0, `waste.unchangedTerminal` 0, `terminalReuseHits` 0, 8 reasoned exclusions. Doc §4 regeneration is git-visible in `23f8891`; "15–25 minutes" explicitly retired there. |
| 3 | Sample provenance real and traceable | CONFIRMED (w/ caveat) | All 26 doc-cited record IDs + 3 receipt paths match the auditor's own live-run `sampleIds` exactly; every file exists on disk under `milestones/prepare-telemetry/`. Caveat: 5 of 26 telemetry files are currently untracked (see Concerns). |
| 4 | Duplicate-generation minutes = real overlap | CONFIRMED | C11 fixture asserts exact 1-minute pairwise intersection, zero for a sequential retry, no group for a singleton; live run: 0 overlap minutes across all four `admission.key` groups. |
| 5 | Degenerate intervals never report 0ms | CONFIRMED | C9 fixture: degenerate receipt excluded as `convergence-interval-degenerate`; the +1ms receipt stays included (`wallTime.receiptPrepareMs.minMs === 1` proves exact-equality-only firing). Live run excludes M192/M195/M204 as degenerate. |
| 6 | absorbed-task/prepare-hour file-presence only | CONFIRMED | C8 fixture: numerator moves 1→2 when `absorb-entry.md` is added on disk; the AND confirmed (absorb-entry.md alone does NOT qualify); zero provider calls (`computeCapacityReport` uses only `node:fs`/`node:path`/`node:crypto`, no MCP/provider import). Live: numeratorCount=9, denominator receipts M198+M200. |
| 7 | C-efficiency measured separately, honest | CONFIRMED | Positive fixture: recomputations=1 with null `contentAgentMs` routed to notMeasured + wallTimeProxy (never fabricated); a correct reuse-terminal is a hit (`terminalReuseHits=1`, `measuredZero`); unknown fixture asserts `estimatedAvoidedAgentMinutes === "unknown"`. Live report: `measuredZero.count=0` reported honestly (see Concerns re: live proof). |
| 8 | hashes.* 4-tuple grouping, negative fixture | CONFIRMED | Negative fixture — two records sharing a cacheable terminal SHAPE but different `hashes.*` — asserts `unchangedTerminalRecomputations === 0` and `groups.length === 0`; passes. |
| 9 | Two wall-time distributions never pooled | CONFIRMED | Fixture asserts exactly two labeled blocks with distinct P50s (fails a blended implementation); live report has both blocks plus an explicit no-pooling note. |
| 10 | Byte-reproducible output | CONFIRMED | Auditor's own two `--out` runs over the same tree are `cmp` byte-identical; `'generatedAtMs' in report === false` verified programmatically. |
| 11 | Feedback-efficiency inputs exported, honest | CONFIRMED | Live report exports cold/resume proxy + contentAgent buckets per stratum, `notMeasured`/`wallTimeProxyMinutes`, and raw absorbed numerator/denominator fields; schema limits (no token counts/novelty) disclosed in doc §4 "Honest limits". |
| 12 | Machine-readable report preserves IDs/strata/exclusions/unknowns | CONFIRMED | Live JSON: `sampleIds`, perPopulation `sampleIds`, perTask `telemetryRecordIds`, recomputation `groupRecordIds`, `exclusions[]` with reasons, `estimatedAvoidedAgentMinutes: "unknown"` — consumable without scraping prose. |
| 13 | interval-fields-missing partial | CONFIRMED | Fixture: exclusion carries `partial: true`; the record still counts in `sampleCount=6`, `byDecisionKind.cold=3`, `agentWork.notMeasured.count=3` — out of overlap analysis only. |
| 14 | Populations best-effort joined | CONFIRMED | C6 fixture: `join.paired=[]`; receipt-only samples still yield `wallTime.receiptPrepareMs.n=3`; telemetry-only samples still yield `yield.attempts=3` + agent-work stats. |
| 15 | `_walkJsonFiles` single shared primitive | CONFIRMED | Source scan: definition at :163, exactly two call sites — :191 (`queryTelemetryReport`) and :274 (`computeCapacityReport`). C2 fixture asserts both function bodies reference it. |
| 16 | `validateTelemetryRecord` reused | CONFIRMED | Imported at :26 from `proposal-convergence.ts`; C3 fixture — a `reuse-terminal` record violating `contentAgentDispatchCount===0 && contentAgentMs===0` lands in `exclusions[]` with reason `reuse-terminal-invalid` and the validator's own message. |
| 17 | `computeConvergenceMetrics`/`computeMetricsForReceipt` reused | CONFIRMED | C4 fixture: the report's receipt p50 equals `computeMetricsForReceipt`'s OWN output (240000) for the identical receipt. |
| 18 | `CACHEABLE_TERMINALS` imported, not hand-copied | CONFIRMED | C5 fixture mutates the REAL imported array — reclassification flips recomputations 0→1, then restores; source scan found no hand-copied allowlist literal (`isCacheableTerminalShape` uses `CACHEABLE_TERMINALS.some()`; the `split-recommended` literals in the file are yield-reason counters/comments, not cacheability). |
| 19 | `queryTelemetryReport` behavior unchanged | CONFIRMED | C7 regression fixture — nested layout, silent-skip, `{ok, code}` shape, embedded-milestoneId filter intact; 56 pre-existing tests stay green within the 80/80 pass (auditor-ran). |
| 20 | Aggregation spans all task IDs | CONFIRMED | AC2 fixture: TASK-A + TASK-B both in `perTask`; live run: 4 distinct telemetry taskIds + receipt taskIds all broken down per-task/per-stratum. |
| 21 | Insufficient-sample honesty | CONFIRMED | Fixtures: typed `insufficient-samples` result with `wallTime === undefined` below gate; combined AND per-population gate; `--min-samples` boundary; empty tree; CLI exit-0 semantics. |
| 22 | Mirrors byte-identical via sync-vendor | CONFIRMED | Auditor's own `cmp` → identical; `sync-vendor.sh --check` → exit 0 CLEAN, `milestone-preparation-check.ts` verified identical. |
| 23 | Grounding identifiers real | CONFIRMED | Auditor direct source read: `computeCapacityReport`, `_walkJsonFiles`, `isCacheableTerminalShape`, the `CACHEABLE_TERMINALS` + `validateTelemetryRecord` imports (:26), `checkPreparation` (now :805 after additive growth from the :294 cited at authoring), `admission.acquiredAt`/`recordedAtMs`/`admission.key`/`hashes.*` on live records; live corpus verified 26 records / 4 taskIds / 6 terminal shapes. |

## DoD verification (4 of 5 confirmed; item 4 honestly open)

1. **Landed on master under human-steered discipline** — CONFIRMED (`23f8891` on master; `human-steered` label).
2. **Real non-fixture run end-to-end + doc regenerated** — CONFIRMED (auditor's own live run exit 0 `code: ok`; doc §4 regenerated in the land commit from that output shape).
3. **≥3 post-change real generations of different terminal shapes** — CONFIRMED (live: 26 real records, 6 distinct terminal shapes across 4 taskIds — clears the bar in aggregate under the charter's cross-task reading).
4. **Real `reuse-terminal` proof included/supplemented** — **UNCONFIRMED, left `- [ ]`**. 0/26 live records are `reuse-terminal`. The zero-content-agent claim is fixture-proven and schema-guaranteed, and `estimatedAvoidedAgentMinutes` honestly reports `"unknown"`, but no live sample witnesses it yet. Disclosed by the implementer in doc §4 "Honest limits", iteration-0.md "Residual open item", and the land commit message, per the task's own Defaults table ("satisfied by a real sample landing, never synthesized here"). Closes when a real `reuse-terminal` generation lands naturally.
5. **Fresh independent audit traces numbers to real artifacts** — CONFIRMED with caveat (this audit; all figures re-derived by the auditor's own run; 5/26 samples untracked — see Concerns).

## Concerns (2; both disclosed; neither a refutation)

1. **5 of 26 provenance samples are untracked** — `milestones/prepare-telemetry/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting/{06ae2770b33b,280d286beda8,29fefa2d9d6e,2fe141fdc3da,54922b2aeb26}.json` are on disk but not git-tracked (M205's concurrent prep generations; `recordedAtMs` 18:06–20:33Z, before the 21:03Z land commit; they check in when M205 lands). DoD item 5's "checked-in" wording is met 21/26 exactly. Headline impact negligible: tracked-only telemetry-proxy P50 29.3m vs the doc's 29.1m; P85 identical 58.8m. The doc's hedge ("the command reproduces whatever the current tree holds") is accurate for the tree, not the git index. → machine-caught deviation row written to dashboard.md.
2. **DoD item 4 live proof absent** — 0/26 `reuse-terminal` records. Honest residual per the task's own design text; DoD checkbox deliberately left unchecked. → machine-caught deviation row written to dashboard.md.

## Write-backs performed by this audit (same pass, same agent)

- `tasks/DIR-126-E.md`: 23/23 AC boxes ticked `- [x]` with per-item evidence citations; DoD items 1/2/3/5 ticked; item 4 left `- [ ]`.
- `milestones/M204/absorb-entry.md`: `adversarial-audit disposition: CONCERNS ...` and `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward` lines appended (vmeta-lag-check.sh --counter 199, exit 0).
- `experiments/quay-perpetual-stream/dashboard.md`: two CONCERNS/machine/M204 deviation rows appended (level/caught-by/caught-at/description/status=open/age=0).

## Mechanical gate

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-E experiments/quay-perpetual-stream/charters/M204-dir126e-capacity-report.md milestones/M204/absorb-entry.md`
→ **exit 0** — all clauses satisfied (12 dispositions confirmed): clause0 (23/23 AC checked),
clause1 (audit disposition present), clause2 (V_meta disposition present), clause3 (line budget),
clause4/5/6/7/8, clause10 (tree-hygiene clean), clause11 (worktree-branch-hygiene clean),
clause12 N/A (no `## Audit-independence check` section yet — Land's ABSORB step completes it,
referencing this artifact; the gate's own note flags that the section must be added since a real
adversarial audit ran).

## Notes for Land

- Full canonical suite (`scripts/test.sh`, auditor-run): **696 tests — 691 pass, 2 fail, 3 skipped**. The ONLY 2 failures are the pre-existing `WIRING-CLAIM R9` pinned-base `git diff` assertions (against base `480cb58` for `prepare-admission-check.ts`) — independently verified pre-M204: that file was modified by `68eb5eb` (M203) and `c82efac` (a gap-fix), both before this build; outside DIR-126-E's touch set. This independently confirms iteration-0.md's disclosure; no M204-attributable test failures.
- Clause12's `## Audit-independence check` ABSORB section should name this artifact (`milestones/M204/audits/iteration-0-acceptance-audit.md`), the orchestrator dispatch record, and audit session id `9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`.
