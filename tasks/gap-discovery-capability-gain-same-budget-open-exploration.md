---
id: gap-discovery-capability-gain-same-budget-open-exploration
title: "Capability Gain: same-budget control vs learned-methods arm in real open
  exploration; net-new findings into the portfolio, negative gain reported"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-coverage-map-from-findings
  - gap-discovery-evidence-level-teaching-vs-independent
---
## Proposal
Point 3 / (C) of the 2026-10-12 strategy change: measure whether learned methods actually add net-new findings in real open exploration. This is a same-budget before/after comparison against a control, and negative gain is recorded. It reuses the existing blind investigator and verifier (`docs/analysis/arch-hypothesis-generation.mjs`: `investigate`/`verify` with `--model`, usage and cost recording) and the portfolio (`gap-discovery-portfolio-value-evidence-ledger`). No new driver and no new scheduler.

## Plan
1. **Pre-register** `/data/home/yale/work/quay-scratch/gain1/prereg.json` before any model call. Record:
   - pin = develop at run time;
   - scope `plugin/scripts/*.ts`;
   - model `v4.1flash-anthropic`;
   - identical budget per arm (runs, verifier cluster cap, turns, timeout);
   - the method set used by the learned arm (ids + versions + status);
   - scoring.
2. **Arms:**
   - **Control:** the frozen investigator prompt and the neutral/provenance inventory, as in the earlier experiments.
   - **Learned:** the same inventory, plus the `operation.steps` and `applicability` of every non-retired, non-contaminated registry method, as neutral method text. No case ids, seed components or answers; the existing anti-leak scan must pass. Retired, quarantined and contaminated methods are excluded mechanically.
3. **Open-domain scoring (not holdout hit rate):** every verifier-supported, non-intentional finding in either arm goes into the portfolio with `evidence_level:"production-open"`.
   - **Duplicates:** an operator dedup against existing tasks and portfolio records marks them.
   - **Net-new:** the remainder are net-new. The operator files real fix tasks only for confirmed defects.
   - **Report per arm:**
     - supported;
     - duplicate / intentional / refuted;
     - net-new;
     - net-new per gateway dollar;
     - coverage grade changes from the coverage map.
4. **Gain = learned − control** on net-new, coverage and cost. Report negative values as negative.
5. No promotion happens in this task. Everything is report-only.

## Acceptance Criteria
- [ ] The pre-registration (`/data/home/yale/work/quay-scratch/gain1/prereg.json`) is written before the first model call (paste mtimes). Both arms run on an identical budget (paste the parameters). The learned arm's method set excludes retired, contaminated and quarantined methods: paste the included and excluded ids.
- [ ] Anti-leak scan on the learned-arm prompt: zero seed components or case ids. Paste the scan result.
- [ ] Real results per arm: supported, duplicate, intentional, refuted, net-new (with the claim and files of each net-new finding), model calls, tokens and gateway cost. Report the gain = learned − control as a number, negative included.
- [ ] Every net-new finding is in `.quay/discovery-portfolio.jsonl` with `evidence_level:"production-open"`. Paste the records.
- [ ] Honest outcome statement: if the gain ≤ 0 or there is no net-new finding, say so. Do not repeat runs to chase a positive number.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-capability-gain-same-budget-open-exploration` green.

## Touches
- tasks/gap-discovery-capability-gain-same-budget-open-exploration.md
- docs/analysis/discovery-capability-gain-report.md (new)
