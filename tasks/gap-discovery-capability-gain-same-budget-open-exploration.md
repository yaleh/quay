---
id: gap-discovery-capability-gain-same-budget-open-exploration
title: "Capability Gain: same-budget control vs learned-methods arm in real open
  exploration; net-new findings into the portfolio, negative gain reported"
status: done
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
- [x] The pre-registration (`/data/home/yale/work/quay-scratch/gain1/prereg.json`) is written before the first model call (paste mtimes). Both arms run on an identical budget (paste the parameters). The learned arm's method set excludes retired, contaminated and quarantined methods: paste the included and excluded ids.
- [x] Anti-leak scan on the learned-arm prompt: zero seed components or case ids. Paste the scan result.
- [x] Real results per arm: supported, duplicate, intentional, refuted, net-new (with the claim and files of each net-new finding), model calls, tokens and gateway cost. Report the gain = learned − control as a number, negative included.
- [x] Every net-new finding is in `.quay/discovery-portfolio.jsonl` with `evidence_level:"production-open"`. Paste the records.
- [x] Honest outcome statement: if the gain ≤ 0 or there is no net-new finding, say so. Do not repeat runs to chase a positive number.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-capability-gain-same-budget-open-exploration` green.

## Evidence
Full reading and tables: `docs/analysis/discovery-capability-gain-report.md`. Raw artifacts under
`/data/home/yale/work/quay-scratch/gain1/` (`prereg.json`, `method-set.json`, `anti-leak-scan.json`,
`investigate-{CTRL,LEARN}.json`, `runs-*`, `verify-*`, `scored.json`, `coverage-{before,after}.json`,
`collect-applied.json`).

- **AC1** — prereg sha256 `7b286c57a3837967333de2b902ad3df99b14cd18e95ccbd85145fb283181922e`, `chmod 444`, mtime
  **2026-10-12 21:52:18 +0800**; first model call (`runs-CTRL/run-1.json`) **21:53:38 +0800** (80 s later);
  `verify` refused no pass. Identical budget both arms: model `v4.1flash-anthropic`, pin `2e5b0359813b397f04300ef5e1c8aafb075d327f`,
  scope `plugin/scripts/*.ts` (285 components), 2 investigator runs/arm, `--tools ""` + empty neutral cwd,
  verifier cap 15 clusters / 8 turns / 300 000 ms, strategy `default`, the same stripped pin, and the SAME
  inventory bytes (`54bc2387482fc419ea76a455f2568abcb737fd7cb70e42fda75a0f76036bb1d9`); the only difference is
  the investigator prompt (`19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea` vs
  `4fca7b870b13a2917e5835c7061d59c72c62dd4d3c866505892bf54f5b471489`, +1138 B).
  Method set — **included:** `carrier-persistence-check` v3 `draft`. **Excluded (mechanical):**
  `composite-subject-verdict-decomposition` v2 retired; `multi-writer-guard-equivalence` v3 retired + quarantined
  lineage; `non-substantive-verdict-triage` v9 retired; `shared-contract-divergence` v7 retired + quarantined
  lineage. No `active` and no `trial` method exists at this pin (rule: status != retired, not quarantined, not on
  `.quay/discovery-contaminated-verdicts.jsonl`).
- **AC2** — the ledger's own scan (`experienceDenyList(root,{scanText})`: 118 records, 0 malformed, 195 component
  basenames + 118 case ids). **Learned-arm prompt alone: `flagged=false, matches=0`.** Learned prompt+inventory:
  193 matches; control prompt+inventory: 193; **set-difference 0** — the method text adds no seed component and no
  case id (the 193 are the inventory naming its own subjects, identical in both arms).
- **AC3** — CTRL: supported 2, intentional 1, duplicate 0, net-new **1**, refuted 5, undetermined 8 (7 turn-limit,
  1 unparseable); LEARN: supported 2, intentional 0, duplicate 0, net-new **2**, refuted 0, undetermined 13 (all
  turn-limit). Model calls 4 investigator + 30 verifier. Tokens — investigator CTRL 76 750 in / 25 803 out, LEARN
  77 220 in / 24 736 out; verifier CTRL 514 795 in / 2 076 544 cache-read / 114 118 out, LEARN 582 719 / 2 370 048 /
  94 242. Gateway cost CTRL **$7.494022**, LEARN **$7.459169**. **Gain = +1 net-new (LEARN 2 − CTRL 1); +0.1347
  net-new per dollar; 0 coverage grade changes; −$0.034853 cost.** After the operator re-check the +1 does NOT
  survive: `LEARN c11` is the same finding as `CTRL c10` over a wider component set (same two components, same two
  regexes, plus 2 modules), and `LEARN c13` rests on a mechanism the code refutes (all four components import the
  single `touches-parser.ts`) and lands on a divergence the file's comment and its test pin as deliberate ⇒
  **confirmed-defect gain = 0**. Net-new findings, files: CTRL `self-report-vocab-audit.ts`,
  `self-report-vocab-check.ts`; LEARN `pane-state-classify.ts`, `self-report-vocab-audit.ts`,
  `self-report-vocab-check.ts`, `semantic-observer-judge.ts`, and `anti-drift-touches-check.ts`,
  `fan-in-ts-typecheck-gate.ts`, `touches-orthogonality-check.ts`, `touches-parser.ts`. Claims verbatim in report §5.
- **AC4** — three records appended to `.quay/discovery-portfolio.jsonl` (portfolio 13 → 16; full rows in report §6):
  `portfolio_finding-18e675aff86564f8` (`GAIN1-CTRL-c10`, components `self-report-vocab-audit.ts`,
  `self-report-vocab-check.ts`), `portfolio_finding-b0a19a72818c6dde` (`GAIN1-LEARN-c11`, components
  `pane-state-classify.ts`, `self-report-vocab-audit.ts`, `self-report-vocab-check.ts`,
  `semantic-observer-judge.ts`), `portfolio_finding-21d4e4db293b2027` (`GAIN1-LEARN-c13`, components
  `anti-drift-touches-check.ts`, `fan-in-ts-typecheck-gate.ts`, `touches-orthogonality-check.ts`,
  `touches-parser.ts`) — all `origin:"autonomous-experiment"`, `evidence_level:"production-open"`,
  `outcome:"supported"`, `fix_task:null`, `duplicate_of:null`, each with a resolvable `origin_ref` (an Experience
  minted for that cluster via `ingestExperience`). `fix_task` is null because a new `tasks/gap-*.md` would land
  outside this task's declared `## Touches` and red the fan-in anti-drift HARD check; the confirmed defect and a
  candidate fix-task title are recorded in report §6 instead.
- **AC5** — stated in report §9: the gain is not a demonstrated capability gain (the +1 does not survive
  inspection; the learnable method set was one draft method about a different defect class; coverage gain 0; the
  cost delta is noise; 9 of 39 clusters were never verified and the learned arm left 13 clusters undetermined).
  **No run was repeated, no cluster re-verified, no arm re-run.**

## Touches
- tasks/gap-discovery-capability-gain-same-budget-open-exploration.md
- docs/analysis/discovery-capability-gain-report.md (new)
